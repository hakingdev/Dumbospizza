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
  debugShots = 0; // лимит скриншотов — на один прогон, а не на жизнь процесса
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
  await clearOverlays(page);
}

/** Суть ошибки Playwright одной строкой: что именно мешало клику. */
function failReason(e) {
  const lines = String(e?.message || e).split('\n').map((l) => l.trim());
  const why = lines.find((l) =>
    /intercepts pointer events|not visible|not attached|outside of the viewport|hidden|detached|disabled/i.test(l)
  );
  return why ? `${lines[0]} — ${why}` : lines[0];
}

let debugShots = 0;
/** Скриншот при сбое (не больше 3 за прогон) — лежит в debug/ рядом со скриптом. */
async function debugScreenshot(page, tag, log) {
  if (debugShots >= 3) return;
  debugShots++;
  try {
    const dir = path.join(__dirname, 'debug');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${tag}-${Date.now()}.png`.replace(/[^\w.\-]+/g, '_'));
    await page.screenshot({ path: file, fullPage: false });
    log(`    скриншот: ${file}`);
  } catch {
    /* скриншот — только для диагностики */
  }
}

/**
 * Hub любит показывать поверх страницы модалки (объявления, новые условия,
 * опросы) и боковые панели — они перехватывают клики по всей странице.
 * Закрываем всё, что видим; true = что-то закрыли (имеет смысл повторить клик).
 */
async function clearOverlays(page, log = console.log) {
  let closed = false;
  if (await dismissCookieBanner(page, log)) closed = true;

  const modal = page.locator(SEL.modal).first();
  if (await modal.isVisible().catch(() => false)) {
    const text = ((await modal.textContent().catch(() => '')) || '').trim().slice(0, 150);
    log(`    модалка поверх страницы: «${text}» — закрываю`);
    const closeBtn = modal.locator('[data-testid="pt-modal-close-btn"]').first();
    if (await closeBtn.count()) await closeBtn.click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape').catch(() => {});
    await modal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    closed = true;
  }

  const sheet = page.locator('[data-testid="side-sheet"]').first();
  if (await sheet.isVisible().catch(() => false)) {
    log('    боковая панель поверх страницы — закрываю (Escape)');
    await page.keyboard.press('Escape').catch(() => {});
    await sheet.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    closed = true;
  }
  return closed;
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
async function openCategory(page, name, log = console.log) {
  const btn = page.locator(SEL.categoryBtn).filter({ hasText: exactText(name) }).first();
  try {
    await btn.click({ timeout: 10000 });
  } catch (e) {
    // Обычный клик не прошёл (что-то поверх страницы / элемент скрыт).
    // Убираем оверлеи и шлём click прямо элементу — обработчик Vue сработает
    // независимо от того, что лежит сверху.
    log(`    клик по категории не прошёл: ${failReason(e)} — пробую в обход`);
    await debugScreenshot(page, `cat-${name}`, log);
    await clearOverlays(page, log);
    await btn.dispatchEvent('click');
  }
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
    // Вторая попытка — на случай, если клик съел всплывший оверлей.
    let attempts = 0;
    while (attempts < 2) {
      attempts++;
      try {
        await openCategory(page, cat, log);
        let items = await collectPaneItems(page);
        if (!wholeCategory) items = items.filter((i) => matches(i.name));
        if (items.length) await handler(cat.trim(), items);
        break;
      } catch (e) {
        if (attempts < 2 && (await clearOverlays(page, log))) continue;
        // Одна сломавшаяся категория не должна ронять весь прогон.
        failedCats.push(cat.trim());
        log(`  ✖ категория «${cat.trim()}» пропущена: ${failReason(e)}`);
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

/**
 * Включить ВСЕ позиции MakiLove.
 * Раньше включали «только то, что выключал скрипт» (state/disabled.json), но
 * список теряется при падениях прогона (26.09: off скрыл всё и упал до записи
 * state — «Включить всё» осталось ни с чем). Hub и сам каждое утро включает
 * все позиции обратно, так что «вернуть всё» — безопасная и ожидаемая
 * семантика кнопки.
 */
export async function runOn({ headless = false, log = console.log } = {}) {
  const { context, page } = await openBrowser({ headless });
  try {
    await openMenu(page);
    let enabled = 0;
    let already = 0;
    let failed = 0;
    const failedCats = await forEachTarget(
      page,
      async (cat, items) => {
        const inactive = items.filter((i) => !i.checked);
        already += items.length - inactive.length;
        if (!inactive.length) return;
        log(`\n${cat} — включаю ${inactive.length}:`);
        for (const item of inactive) {
          const ok = await setItem(page, item, true, log).catch(() => false);
          if (ok) {
            enabled++;
            log(`  ✔ ${item.name}`);
          } else {
            failed++;
            log(`  ✖ НЕ ВКЛЮЧИЛОСЬ: ${item.name}`);
          }
        }
      },
      log
    );
    // всё включено — старый список выключенного больше не актуален
    saveState({ disabled: [] });
    log(`\nВключено: ${enabled}, уже были включены: ${already}${failed ? `, ошибок: ${failed}` : ''}.`);
    const problems = [];
    if (failed) problems.push(`не включилось позиций: ${failed}`);
    if (failedCats.length) problems.push(`не открылись категории: ${failedCats.join(', ')}`);
    return {
      ok: problems.length === 0,
      count: enabled,
      failed: failed + failedCats.length,
      message: problems.join('; '),
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
