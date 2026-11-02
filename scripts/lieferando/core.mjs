/**
 * Ядро управления доступностью позиций в Lieferando Partner Hub
 * (страница «Artikelverfügbarkeit»: /menu/item-availability).
 *
 * Используется двумя обёртками:
 *   toggle.mjs — ручной CLI (login/list/off/on/set-size/set-item/…);
 *   agent.mjs  — демон (VDS/кассовый ПК), выполняющий команды стоп-бота.
 *
 * Три вида целей:
 *   MakiLove (runOff/runOn) — позиция считается MakiLove, если «makilove» есть
 *     в названии ЕЁ КАТЕГОРИИ (в Hub все суши разложены по категориям
 *     «Makilove …») ЛИБО в названии самой позиции;
 *   размер (runSet, kind:'size') — у каждой строки категорий вне MakiLove есть
 *     переключатели ВАРИАНТОВ ([data-test-id="variation"]: «30 cm», «36 cm»,
 *     «Ca. 27×37 cm (entspricht ca. Ø 36 cm Pizza)», «6stk»); подпись сайта
 *     («30 cm», «ca. 27x37», «6 Stk») матчится по числам — sizeKey();
 *   позиция (runSet, kind:'item') — общий переключатель строки, чьё имя
 *     совпадает с именем сайта нормализованно (без «Pizza», «(rund)»,
 *     регистра, пунктуации) — itemKey(); «Hawaiian» переключает и
 *     «Hawaiian Pizza», и «Hawaiian Pizza (rund)».
 *
 * ⚠️ Особенность Hub: выключение действует «до конца дня» — на следующий день
 * Lieferando сам вернёт позиции/размеры в продажу.
 *
 * Playwright импортируется лениво (в openBrowser): чистые матчеры
 * (sizeKey/itemKey) тогда можно тестировать vitest'ом без браузера.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// LIEFERANDO_PROFILE_DIR — другой профиль браузера (тесты переноса сессии, сервер)
const PROFILE_DIR = process.env.LIEFERANDO_PROFILE_DIR || path.join(__dirname, 'profile');
const STATE_FILE = path.join(__dirname, 'state', 'disabled.json');

export const HUB_URL = 'https://partner-hub.takeaway.com/';
const MENU_URL = 'https://partner-hub.takeaway.com/menu/item-availability';

const MATCH = process.env.MATCH || 'makilove';
const norm = (s) => (s || '').toLowerCase().replace(/[\s ]+/g, '');
const matches = (name) => norm(name).includes(norm(MATCH));

/**
 * Ключ размера — числа подписи, отсортированные и склеенные через «x»:
 *   «30 cm» → «30»; «ca. 27x37» и «Ca. 27×37 cm (entspricht ca. Ø 36 cm Pizza)»
 *   → «27x37»; «6 Stk» и «6stk» → «6». Хвост в скобках и после «≈»/«Ø»/
 *   «entspricht» отбрасываем — там пересчёт в диаметр, он сбил бы матч.
 *   Пустая строка = чисел нет (такую цель не выполняем).
 */
export function sizeKey(label) {
  const head = String(label || '')
    .replace(/\(.*$/s, '')
    .split(/≈|ø|entspricht/i)[0];
  const nums = (head.match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(n.replace(',', '.')));
  return nums.sort((a, b) => a - b).join('x');
}

/**
 * Ключ позиции для сравнения имени сайта с Hub-строкой: без «Pizza»,
 * «(rund)», маркетингового «Neu:», регистра, пунктуации и пробелов.
 *   «Hawaiian» ≡ «Hawaiian Pizza» ≡ «Hawaiian Pizza (rund)»;
 *   «Katz's Corner» ≡ «Katz’s Corner (rund)»; «Hot Dog Pizza» ≡ «Hotdog-Pizza».
 */
export function itemKey(name) {
  return String(name || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^\s*neu\s*:/, ' ')
    .replace(/\(\s*rund\s*\)/g, ' ')
    .replace(/\bpizza\b/g, ' ')
    .replace(/[’'`´"„“”.,;:!?&+\-–—/\\()]/g, ' ')
    .replace(/\s+/g, '');
}

// Селекторы сняты с реального DOM Partner Hub (август 2026; варианты — ноябрь 2026).
const SEL = {
  categoryBtn: 'button[data-test-id="categoriesListItemLink"]',
  paneCategoryName: '[data-test-id="itemsListCategoryName"]',
  itemRow: '[data-test-id="item"]',
  itemName: 'span.font-black',
  toggleLabel: '[data-test-id="toggle-switch-component"] label',
  toggleInput: '[data-test-id="toggle-switch-component"] input[type="checkbox"]',
  /** вариант строки (размер/порция) — со своим toggle-switch-component внутри */
  variation: '[data-test-id="variation"]',
  /** общий переключатель строки: toggle вне вариантов и групп опций */
  generalToggle:
    'xpath=.//*[@data-test-id="toggle-switch-component"][not(ancestor::*[@data-test-id="variation"]) and not(ancestor::*[@data-test-id="group"])]',
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

/** Режим браузера для ручных команд: HEADLESS=1/0 из env, иначе — с окном,
 *  кроме Linux-сервера без дисплея (там окно открыть некуда). */
export function defaultHeadless() {
  if (process.env.HEADLESS != null && process.env.HEADLESS !== '') {
    return process.env.HEADLESS !== '0';
  }
  return process.platform === 'linux' && !process.env.DISPLAY;
}

export async function openBrowser({ headless = false } = {}) {
  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    viewport: { width: 1400, height: 900 },
    locale: 'de-DE',
  });
  const page = context.pages()[0] || (await context.newPage());
  return { context, page };
}

/** Какой ресторан выбирать на экране /choose-business (у аккаунта их несколько). */
const BUSINESS = process.env.LIEFERANDO_BUSINESS || 'Dumbo Slice';

/**
 * Hub после входа (и после переноса сессии на другую машину) показывает
 * «Businesses — select which business you would like to continue with».
 * Выбираем наш по названию; true = экран был и мы его прошли.
 */
async function chooseBusinessIfAsked(page, log = console.log) {
  if (!/\/choose-business/.test(page.url())) return false;
  log(`Hub просит выбрать ресторан — выбираю «${BUSINESS}»…`);
  await dismissCookieBanner(page, log);
  const re = new RegExp(escapeRe(BUSINESS), 'i');
  const entry = page.locator('a, button, li, [role="button"]').filter({ hasText: re }).first();
  if (await entry.count()) await entry.click({ timeout: 10000 });
  else await page.getByText(re).first().click({ timeout: 10000 });
  await page.waitForURL((u) => !/\/choose-business/.test(String(u)), { timeout: 15000 });
  return true;
}

export async function openMenu(page) {
  debugShots = 0; // лимит скриншотов — на один прогон, а не на жизнь процесса
  await page.goto(MENU_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500); // даём редиректу на /choose-business случиться
  if (await chooseBusinessIfAsked(page)) {
    await page.goto(MENU_URL, { waitUntil: 'domcontentloaded' });
  }
  const ok = await page
    .waitForSelector(SEL.categoryBtn, { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    throw new Error(
      `Категории не загрузились (url: ${page.url()}) — скорее всего, сессия истекла. ` +
        'Вход: node toggle.mjs login, либо перенос сессии: export-session / import-session'
    );
  }
  directClicks = false;
  await dismissCookieBanner(page);
  await clearOverlays(page);
  await page.waitForTimeout(2000); // промо-попапы Hub всплывают с задержкой
  await clearOverlays(page);
}

/** После первого перехвата клика оверлеем — дальше кликаем событием сразу,
 *  не ожидая таймаут на каждом элементе (52 переключателя × 8 с — это вечность). */
let directClicks = false;
const interceptedByOverlay = (e) => /intercepts pointer events/i.test(String(e?.message || e));

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

  // pie-modal — промо-попапы и объявления Hub (03.10: «halloween_260928_popup»),
  // лежат поверх всей страницы и перехватывают все клики. Их может быть
  // несколько подряд — закрываем, пока видим.
  // Хост <pie-modal> для Playwright «невидим» (диалог живёт в его shadow DOM),
  // поэтому смотрим на сам диалог/крестик — локаторы shadow DOM пробивают.
  for (let i = 0; i < 3; i++) {
    const dialog = page.locator('pie-modal [data-test-id="pie-modal"]').first();
    const closeBtn = page.locator('pie-modal [data-test-id="modal-close-button"]').first();
    const dialogVisible = await dialog.isVisible().catch(() => false);
    const closeVisible = await closeBtn.isVisible().catch(() => false);
    if (!dialogVisible && !closeVisible) break;
    const cls = (await page.locator('pie-modal').first().getAttribute('class').catch(() => '')) || '';
    log(`    промо-модалка Hub поверх страницы (${cls.trim().slice(0, 60)}) — закрываю`);
    if (closeVisible) await closeBtn.click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape').catch(() => {});
    const gone = await dialog
      .waitFor({ state: 'hidden', timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    if (!gone) {
      await page.keyboard.press('Escape').catch(() => {});
      await dialog.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }
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
    if (directClicks) await btn.dispatchEvent('click');
    else await btn.click({ timeout: 10000 });
  } catch (e) {
    if (interceptedByOverlay(e)) directClicks = true;
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

/**
 * Строки текущей категории с общим переключателем и (по запросу) вариантами:
 *   { name, general: { checked, label, input }, variations: [{ text, key, checked, label, input }] }
 * general/variation — в формате, который понимает setItem().
 */
async function collectPaneRows(page, { withVariations = false } = {}) {
  const rows = page.locator(SEL.itemRow);
  const count = await rows.count();
  const out = [];
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const name = ((await row.locator(SEL.itemName).first().textContent().catch(() => '')) || '').trim();
    if (!name) continue;
    const general = row.locator(SEL.generalToggle).first();
    const gInput = general.locator('input[type="checkbox"]').first();
    if ((await gInput.count()) === 0) continue;
    const entry = {
      name,
      general: { checked: await gInput.isChecked(), label: general.locator('label').first(), input: gInput },
      variations: [],
    };
    if (withVariations) {
      const vars = row.locator(SEL.variation);
      const vn = await vars.count();
      for (let j = 0; j < vn; j++) {
        const v = vars.nth(j);
        const input = v.locator(SEL.toggleInput).first();
        if ((await input.count()) === 0) continue;
        const text = ((await v.textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
        entry.variations.push({
          text,
          key: sizeKey(text),
          checked: await input.isChecked(),
          label: v.locator(SEL.toggleLabel).first(),
          input,
        });
      }
    }
    out.push(entry);
  }
  return out;
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
  try {
    if (directClicks) await item.input.dispatchEvent('click');
    else await item.label.click({ timeout: 8000 });
  } catch (e) {
    if (interceptedByOverlay(e)) directClicks = true;
    // Переключатель перекрыт (модалка/панель) — закрываем оверлеи и шлём
    // click прямо чекбоксу: браузер переключит его и дёрнет change для Vue.
    log(`    клик по переключателю не прошёл: ${failReason(e)} — пробую в обход`);
    await clearOverlays(page, log);
    await item.input.dispatchEvent('click');
  }
  await confirmModalIfAny(page, log);
  const ok = await waitChecked(item.input, makeAvailable);
  await page.waitForTimeout(600); // не молотим Hub очередями
  return ok;
}

/**
 * Обходит категории сайдбара, для которых shouldVisit(name) истинно, открывает
 * каждую и зовёт handler(category). Одна сломавшаяся категория не роняет
 * прогон: вторая попытка после закрытия оверлея, затем — в список пропущенных.
 */
async function walkCategories(page, shouldVisit, handler, log = console.log) {
  const cats = await categoryNames(page);
  const failedCats = [];
  for (const cat of cats) {
    if (!shouldVisit(cat)) continue;
    // Вторая попытка — на случай, если клик съел всплывший оверлей.
    let attempts = 0;
    while (attempts < 2) {
      attempts++;
      try {
        await openCategory(page, cat, log);
        await handler(cat.trim());
        break;
      } catch (e) {
        if (attempts < 2 && (await clearOverlays(page, log))) continue;
        failedCats.push(cat.trim());
        log(`  ✖ категория «${cat.trim()}» пропущена: ${failReason(e)}`);
        break;
      }
    }
  }
  return failedCats;
}

/**
 * Обходит категории MakiLove и вызывает handler(category, items) для позиций,
 * подпадающих под MATCH (вся категория либо отдельная позиция по имени).
 */
async function forEachTarget(page, handler, log = console.log) {
  // Чужие категории смотрим только при FULL_SCAN=1: все позиции MakiLove живут
  // в категориях «Makilove …», а лишние заходы удваивают время прогона и
  // поверхность отказов (26.09 весь off упал на «Alkoholische Getränke»).
  const fullScan = process.env.FULL_SCAN === '1';
  return walkCategories(
    page,
    (cat) => matches(cat) || fullScan,
    async (cat) => {
      let items = await collectPaneItems(page);
      if (!matches(cat)) items = items.filter((i) => matches(i.name));
      if (items.length) await handler(cat, items);
    },
    log
  );
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

/**
 * Выключить/включить цель стоп-бота вне MakiLove — во всех категориях, кроме
 * «Makilove …»:
 *   { kind: 'size', label }   — вариант с подходящей подписью (sizeKey) у каждой
 *                               строки: «30 cm» у всех круглых пицц и т.п.;
 *   { kind: 'item', names[] } — общий переключатель строк, чьё имя совпадает с
 *                               одним из names (itemKey): и Detroit, и «(rund)».
 * available: true = включить, false = выключить. dryRun — только показать.
 * Возвращает { ok, count, already, failed, categories, notFound, message }.
 */
export async function runSet({ target, available, headless = false, dryRun = false, log = console.log }) {
  if (!target || (target.kind !== 'size' && target.kind !== 'item')) {
    throw new Error(`runSet: неизвестная цель ${JSON.stringify(target)}`);
  }
  const wantKey = target.kind === 'size' ? sizeKey(target.label) : null;
  if (target.kind === 'size' && !wantKey) {
    throw new Error(`runSet: в подписи размера «${target.label}» нет чисел — нечего искать`);
  }
  // ключ → имя сайта (для отчёта «не найдено» своими словами)
  const wantNames = new Map(
    target.kind === 'item' ? (target.names || []).map((n) => [itemKey(n), n]).filter(([k]) => k) : []
  );
  if (target.kind === 'item' && !wantNames.size) {
    throw new Error('runSet: пустой список позиций');
  }
  const verb = available ? 'включаю' : 'выключаю';
  const stateWord = available ? 'вкл' : 'выкл';

  const { context, page } = await openBrowser({ headless });
  try {
    await openMenu(page);
    let count = 0;
    let already = 0;
    let failed = 0;
    const categories = [];
    const foundKeys = new Set();

    const failedCats = await walkCategories(
      page,
      (cat) => !matches(cat),
      async (cat) => {
        const rows = await collectPaneRows(page, { withVariations: target.kind === 'size' });
        const hits = [];
        for (const row of rows) {
          if (target.kind === 'size') {
            for (const v of row.variations) {
              if (v.key === wantKey) hits.push({ what: `${row.name} — ${v.text}`, toggle: v });
            }
          } else {
            const key = itemKey(row.name);
            if (wantNames.has(key)) {
              foundKeys.add(key);
              hits.push({ what: row.name, toggle: row.general });
            }
          }
        }
        if (!hits.length) return;
        categories.push(cat);
        const todo = hits.filter((h) => h.toggle.checked !== available);
        already += hits.length - todo.length;
        log(`\n${cat}: найдено ${hits.length}, ${verb} ${todo.length}${dryRun ? ' (dry run — не кликаю)' : ''}:`);
        for (const h of hits) if (h.toggle.checked === available) log(`  = уже ${stateWord}: ${h.what}`);
        for (const h of todo) {
          if (dryRun) {
            log(`  → ${h.what}`);
            continue;
          }
          const ok = await setItem(page, h.toggle, available, log).catch(() => false);
          if (ok) {
            count++;
            log(`  ✔ ${h.what}`);
          } else {
            failed++;
            log(`  ✖ НЕ ПЕРЕКЛЮЧИЛОСЬ: ${h.what}`);
          }
        }
      },
      log
    );

    const notFound =
      target.kind === 'size'
        ? categories.length
          ? []
          : [target.label]
        : [...wantNames].filter(([k]) => !foundKeys.has(k)).map(([, n]) => n);

    log(
      `\nПереключено: ${count}, уже были ${stateWord}: ${already}` +
        (failed ? `, ошибок: ${failed}` : '') +
        (categories.length ? ` — ${categories.join(', ')}` : '') +
        (notFound.length ? `\n⚠️ Не найдено: ${notFound.join(', ')}` : '') +
        (failedCats.length ? `\n⚠️ Не открылись категории: ${failedCats.join(', ')}` : '')
    );
    const problems = [];
    if (failed) problems.push(`не переключилось: ${failed}`);
    if (failedCats.length) problems.push(`не открылись категории: ${failedCats.join(', ')}`);
    return {
      ok: problems.length === 0,
      count,
      already,
      failed: failed + failedCats.length,
      categories,
      notFound,
      message: problems.join('; '),
    };
  } finally {
    await context.close();
  }
}

/** Открыть окно для ручного входа; закрытие окна = конец. */
export async function runLogin() {
  if (defaultHeadless()) {
    console.log(
      'Здесь нет дисплея — войти руками нельзя. Перенесите сессию с машины, где вход уже сделан:\n' +
        '  там:   node toggle.mjs export-session   → session.json\n' +
        '  здесь: node toggle.mjs import-session session.json'
    );
    process.exit(1);
  }
  const { context, page } = await openBrowser({ headless: false });
  await page.goto(HUB_URL);
  console.log('Войдите в Partner Hub в открывшемся окне.');
  console.log('Когда увидите кабинет — просто закройте окно браузера.');
  await context.waitForEvent('close', { timeout: 0 }).catch(() => {});
}

/**
 * Перенос сессии Hub на другую машину (например, на Linux-сервер без экрана).
 * Папку profile/ между ОС копировать нельзя — cookies там зашифрованы ключами
 * ОС; Playwright же отдаёт их расшифрованными через storageState.
 * session.json = доступ к кабинету Lieferando, после импорта удалить.
 */
export async function exportSession({ file, log = console.log } = {}) {
  const { context, page } = await openBrowser({ headless: true });
  try {
    // storageState берёт localStorage только у origin'ов, открытых в сессии
    await page.goto(HUB_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(1500);
    const state = await context.storageState();
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
    const hub = state.cookies.filter((c) => /takeaway|justeat|lieferando/i.test(c.domain)).length;
    log(`Сессия сохранена в ${file}: cookies ${state.cookies.length} (Hub: ${hub}), origins ${state.origins.length}.`);
    if (!hub) log('⚠️ Cookies Partner Hub не найдены — на этой машине сессии нет (node toggle.mjs login).');
    log('⚠️ Файл даёт доступ к кабинету Lieferando — после импорта на сервере удалите его.');
  } finally {
    await context.close();
  }
}

export async function importSession({ file, headless = defaultHeadless(), log = console.log } = {}) {
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { context, page } = await openBrowser({ headless });
  try {
    await context.addCookies(state.cookies || []);
    // localStorage пишем init-скриптом при первом заходе на origin — это
    // внедряется через CDP до скриптов страницы и не упирается в CSP.
    if (state.origins?.length) {
      await context.addInitScript((origins) => {
        const o = origins.find((x) => x.origin === location.origin);
        if (!o || localStorage.getItem('__lief_session_imported')) return;
        for (const { name, value } of o.localStorage) localStorage.setItem(name, value);
        localStorage.setItem('__lief_session_imported', '1');
      }, state.origins);
    }
    await page.goto(HUB_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    log(`Импортировано: cookies ${state.cookies?.length || 0}, origins ${state.origins?.length || 0}. Проверяю вход…`);
    let ok = true;
    let why = '';
    try {
      await openMenu(page);
    } catch (e) {
      ok = false;
      why = String(e?.message || e).split('\n')[0];
    }
    if (ok) {
      log('✅ Сессия принята: меню Partner Hub открывается. Дальше: node toggle.mjs list');
      fs.rmSync(file, { force: true });
      log(`${file} удалён.`);
    } else {
      await debugScreenshot(page, 'import-session', log);
      log(`❌ Hub не принял сессию с этой машины: ${why}\n   См. скриншот в debug/; возможно, ботозащита или сессия уже истекла.`);
      process.exitCode = 1;
    }
  } finally {
    await context.close();
  }
}
