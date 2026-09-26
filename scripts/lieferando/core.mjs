/**
 * Ядро управления позициями MakiLove в Lieferando Partner Hub
 * (страница «Artikelverfügbarkeit»: /menu/item-availability).
 *
 * Используется двумя обёртками:
 *   toggle.mjs — ручной CLI (login/list/off/on);
 *   agent.mjs  — демон на кассовом ПК, выполняющий команды стоп-бота.
 *
 * Как ищем: позиция считается MakiLove, если «makilove» есть в названии ЕЁ
 * КАТЕГОРИИ (в Hub все суши разложены по категориям «Makilove …») ЛИБО в
 * названии самой позиции. Скрипт проходит по всем категориям слева.
 *
 * ⚠️ Особенность Hub: выключение действует «до конца дня» — на следующий день
 * Lieferando сам вернёт позиции в продажу.
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, 'profile');
const STATE_FILE = path.join(__dirname, 'state', 'disabled.json');

export const HUB_URL = 'https://partner-hub.takeaway.com/';
const MENU_URL = 'https://partner-hub.takeaway.com/menu/item-availability';

const MATCH = process.env.MATCH || 'makilove';
const norm = (s) => (s || '').toLowerCase().replace(/[\s ]+/g, '');
const matches = (name) => norm(name).includes(norm(MATCH));

// Селекторы сняты с реального DOM Partner Hub (август 2026).
const SEL = {
  categoryBtn: 'button[data-test-id="categoriesListItemLink"]',
  paneCategoryName: '[data-test-id="itemsListCategoryName"]',
  itemRow: '[data-test-id="item"]',
  itemName: 'span.font-black',
  toggleLabel: '[data-test-id="toggle-switch-component"] label',
  toggleInput: '[data-test-id="toggle-switch-component"] input[type="checkbox"]',
  modal: '[data-testid="pt-modal"]',
};

// --- состояние «что выключали мы» ---------------------------------------------

export function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { disabled: [] };
  }
}

export function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// --- браузер --------------------------------------------------------------------

export async function openBrowser({ headless = false } = {}) {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    viewport: { width: 1400, height: 900 },
    locale: 'de-DE',
  });
  const page = context.pages()[0] || (await context.newPage());
  return { context, page };
}

export async function openMenu(page) {
  await page.goto(MENU_URL, { waitUntil: 'domcontentloaded' });
  const ok = await page
    .waitForSelector(SEL.categoryBtn, { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    throw new Error(
      'Категории не загрузились — скорее всего, сессия истекла. На этом ПК: node toggle.mjs login'
    );
  }
  await dismissCookieBanner(page);
}

async function categoryNames(page) {
  return page.locator(SEL.categoryBtn).allTextContents();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Точный матч текста кнопки (hasText со строкой — подстрочный: «Pizza»
 *  совпал бы с «Mini Pizza Quartett»). */
const exactText = (s) => new RegExp(`^\\s*${escapeRe(s.trim())}\\s*$`);

/** Кликает категорию в сайдбаре и ждёт, пока справа отрисуется именно она.
 *  Без page.waitForFunction: CSP Hub блокирует инжектированные скрипты,
 *  поэтому ждём поллингом через локаторы. */
async function openCategory(page, name) {
  await page
    .locator(SEL.categoryBtn)
    .filter({ hasText: exactText(name) })
    .first()
    .click();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const txt = await page
      .locator(SEL.paneCategoryName)
      .first()
      .textContent()
      .catch(() => '');
    if ((txt || '').trim() === name.trim()) {
      await page.waitForTimeout(500); // дорисовка строк
      return;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Категория «${name}» не открылась за 15 с`);
}

/** Позиции текущей открытой категории: { name, checked, label, input }. */
async function collectPaneItems(page) {
  const rows = page.locator(SEL.itemRow);
  const count = await rows.count();
  const items = [];
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const name = (await row.locator(SEL.itemName).first().textContent())?.trim();
    const input = row.locator(SEL.toggleInput).first();
    if (!name || (await input.count()) === 0) continue;
    items.push({
      name,
      checked: await input.isChecked(),
      label: row.locator(SEL.toggleLabel).first(),
      input,
    });
  }
  return items;
}

/** Если Hub показал модалку подтверждения — жмём согласие. */
async function confirmModalIfAny(page, log) {
  const modal = page.locator(SEL.modal).first();
  const visible = await modal.isVisible().catch(() => false);
  if (!visible) return;
  log('    (модалка: ' + ((await modal.textContent()) || '').trim().slice(0, 120) + ')');
  const btn = modal
    .locator('button', { hasText: /bestätig|ja|ok|speicher|entfern|fortfahren/i })
    .first();
  if (await btn.count()) await btn.click().catch(() => {});
  await modal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
}

/** Куки-баннер Hub (pie-cookie-banner) перекрывает низ сайдбара и молча
 *  съедает клики (locator resolved → intercepts pointer events). Закрываем
 *  самым приватным вариантом — «только необходимые cookies»; выбор
 *  сохраняется в профиле, так что действие фактически одноразовое.
 *  Playwright пробивает shadow DOM компонента обычным локатором. */
async function dismissCookieBanner(page, log = console.log) {
  const banner = page.locator('pie-cookie-banner');
  if (!(await banner.count().catch(() => 0))) return false;
  try {
    await page.locator('[data-test-id="actions-necessary-only"]').first().click({ timeout: 5000 });
    await banner.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    log('Куки-баннер закрыт («только необходимые»).');
    return true;
  } catch (e) {
    log(`⚠️ Куки-баннер виден, но закрыть не удалось: ${String(e?.message || e).split('\n')[0]}`);
    return false;
  }
}

/** Ждёт, пока чекбокс примет ожидаемое состояние (подтверждение от сервера). */
async function waitChecked(input, expected, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await input.isChecked()) === expected) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function setItem(page, item, makeAvailable, log) {
  await item.label.scrollIntoViewIfNeeded();
  await item.label.click();
  await confirmModalIfAny(page, log);
  const ok = await waitChecked(item.input, makeAvailable);
  await page.waitForTimeout(600); // не молотим Hub очередями
  return ok;
}

/**
 * Обходит все категории и вызывает handler(category, items) для позиций,
 * подпадающих под MATCH (вся категория либо отдельная позиция по имени).
 */
async function forEachTarget(page, handler, log = console.log) {
  const cats = await categoryNames(page);
  // Чужие категории смотрим только при FULL_SCAN=1: все позиции MakiLove живут
  // в категориях «Makilove …», а лишние заходы удваивают время прогона и
  // поверхность отказов (26.09 весь off упал на «Alkoholische Getränke»).
  const fullScan = process.env.FULL_SCAN === '1';
  const failedCats = [];
  for (const cat of cats) {
    const wholeCategory = matches(cat);
    if (!wholeCategory && !fullScan) continue;
    // Вторая попытка — на случай, если клик съел всплывший куки-баннер.
    let attempts = 0;
    while (attempts < 2) {
      attempts++;
      try {
        await openCategory(page, cat);
        let items = await collectPaneItems(page);
        if (!wholeCategory) items = items.filter((i) => matches(i.name));
        if (items.length) await handler(cat.trim(), items);
        break;
      } catch (e) {
        if (attempts < 2 && (await dismissCookieBanner(page, log))) continue;
        // Одна сломавшаяся категория не должна ронять весь прогон.
        failedCats.push(cat.trim());
        log(`  ✖ категория «${cat.trim()}» пропущена: ${String(e?.message || e).split('\n')[0]}`);
        break;
      }
    }
  }
  return failedCats;
}

// --- высокоуровневые операции (обе обёртки зовут только их) --------------------

/** DRY RUN: перечислить все позиции MakiLove и их состояние. */
export async function runList({ headless = false, log = console.log } = {}) {
  const { context, page } = await openBrowser({ headless });
  try {
    await openMenu(page);
    let total = 0;
    const failedCats = await forEachTarget(
      page,
      async (cat, items) => {
        log(`\n${cat}`);
        for (const i of items) {
          log(`  [${i.checked ? 'вкл ' : 'ВЫКЛ'}] ${i.name}`);
          total++;
        }
      },
      log
    );
    if (failedCats.length) log(`\n⚠️ Не открылись категории: ${failedCats.join(', ')}`);
    log(`\nИтого позиций MakiLove: ${total}`);
    return { ok: true, count: total, failed: 0, message: '' };
  } finally {
    await context.close();
  }
}

/** Выключить все включённые позиции MakiLove; список — в state/disabled.json. */
export async function runOff({ headless = false, log = console.log } = {}) {
  const { context, page } = await openBrowser({ headless });
  try {
    await openMenu(page);
    const disabled = [];
    let failed = 0;
    // state пишем после КАЖДОЙ позиции: аборт прогона не должен терять список
    // уже выключенного, иначе «Включить обратно» не найдёт что включать.
    const save = () => saveState({ disabled, at: new Date().toISOString() });
    const failedCats = await forEachTarget(
      page,
      async (cat, items) => {
        const active = items.filter((i) => i.checked);
        if (!active.length) return;
        log(`\n${cat} — выключаю ${active.length}:`);
        for (const item of active) {
          const ok = await setItem(page, item, false, log).catch(() => false);
          if (ok) {
            disabled.push({ category: cat, name: item.name });
            save();
            log(`  ✔ ${item.name}`);
          } else {
            failed++;
            log(`  ✖ НЕ ВЫКЛЮЧИЛОСЬ: ${item.name}`);
          }
        }
      },
      log
    );
    save();
    log(`\nВыключено: ${disabled.length}${failed ? `, ошибок: ${failed}` : ''}.`);
    const problems = [];
    if (failed) problems.push(`не выключилось позиций: ${failed}`);
    if (failedCats.length) problems.push(`не открылись категории: ${failedCats.join(', ')}`);
    return {
      ok: problems.length === 0,
      count: disabled.length,
      failed: failed + failedCats.length,
      message: problems.join('; '),
    };
  } finally {
    await context.close();
  }
}

/** Включить обратно ровно то, что выключал runOff (из state/disabled.json). */
export async function runOn({ headless = false, log = console.log } = {}) {
  const state = loadState();
  if (!state.disabled?.length) {
    return {
      ok: true,
      count: 0,
      failed: 0,
      message: 'включать нечего: скрипт ничего не выключал',
    };
  }
  const { context, page } = await openBrowser({ headless });
  try {
    await openMenu(page);

    // группируем по категориям, чтобы не прыгать по сайдбару лишний раз
    const byCat = new Map();
    for (const e of state.disabled) {
      if (!byCat.has(e.category)) byCat.set(e.category, []);
      byCat.get(e.category).push(e.name);
    }

    let ok = 0;
    const leftover = [];
    for (const [cat, names] of byCat) {
      let items;
      try {
        await openCategory(page, cat);
        items = await collectPaneItems(page);
      } catch (e) {
        log(`  ✖ категория «${cat}» не открылась: ${String(e?.message || e).split('\n')[0]}`);
        for (const name of names) leftover.push({ category: cat, name });
        continue;
      }
      const byName = new Map(items.map((i) => [norm(i.name), i]));
      log(`\n${cat} — включаю ${names.length}:`);
      for (const name of names) {
        const item = byName.get(norm(name));
        if (!item) {
          log(`  ✖ не нашёл на странице: ${name}`);
          leftover.push({ category: cat, name });
          continue;
        }
        if (item.checked) {
          log(`  – уже включено: ${name}`);
          ok++;
          continue;
        }
        const good = await setItem(page, item, true, log).catch(() => false);
        if (good) {
          log(`  ✔ ${name}`);
          ok++;
        } else {
          log(`  ✖ НЕ ВКЛЮЧИЛОСЬ: ${name}`);
          leftover.push({ category: cat, name });
        }
      }
    }
    saveState({ disabled: leftover });
    log(`\nВключено: ${ok}/${state.disabled.length}.`);
    return {
      ok: leftover.length === 0,
      count: ok,
      failed: leftover.length,
      message: leftover.length ? `не включилось позиций: ${leftover.length}` : '',
    };
  } finally {
    await context.close();
  }
}

/** Открыть окно для ручного входа; закрытие окна = конец. */
export async function runLogin() {
  const { context, page } = await openBrowser({ headless: false });
  await page.goto(HUB_URL);
  console.log('Войдите в Partner Hub в открывшемся окне.');
  console.log('Когда увидите кабинет — просто закройте окно браузера.');
  await context.waitForEvent('close', { timeout: 0 }).catch(() => {});
}
