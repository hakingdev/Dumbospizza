/**
 * Агент Lieferando (VDS / кассовый ПК) — исполнитель команд стоп-бота.
 *
 * Поллит GET /api/lieferando/agent (раз в POLL_MS); получив команду
 * { id, action: off|on, target }, прокликивает переключатели в Partner Hub
 * (core.mjs) и отчитывается POST'ом — сервер шлёт итог в Telegram-группу
 * стоп-бота. Цели (target.kind): makilove — все позиции MakiLove (runOff/runOn);
 * size — размер у всех строк вне MakiLove; item — позиции по именам (runSet);
 * catalog — снимок всего каталога Hub (runCatalog, ничего не переключает),
 * который уходит POST'ом на /api/lieferando/agent/catalog — сервер сверяет его
 * с сайтом и пишет в группу только изменения.
 * Заголовок X-Agent-Caps: targets catalog говорит серверу, что size/item и
 * catalog нам можно отдавать (старому агенту без них сервер их не отдаёт).
 *
 * Снимок каталога агент снимает и САМ — первый раз в CATALOG_HOUR по
 * Europe/Berlin (по умолчанию 09:00), дальше до полуночи каждые
 * CATALOG_EVERY_MIN минут (по умолчанию 60), когда очередь пуста: экран бота
 * показывает состояние позиций на Lieferando, а его меняют и руками в Hub,
 * и сам Hub (утром включает всё обратно). Цикл агента строго
 * последовательный, поэтому второй браузер рядом с утренним перевыключением
 * бессрочного стоп-листа (сервер ставит его в очередь после 08:30) не
 * откроется: сначала команды, потом каталог.
 *
 * env (можно в .env рядом, см. README):
 *   LIEFERANDO_AGENT_SECRET — общий секрет (или PRINT_AGENT_SECRET, как у печати)
 *   API_BASE_URL            — по умолчанию https://www.dumbospizza.de (строго www!
 *                             apex отвечает 308 и POST теряется — как у print-agent)
 *   LIEFERANDO_POLL_MS      — период поллинга, по умолчанию 20000
 *   LIEFERANDO_CATALOG_HOUR — час (Europe/Berlin) первого снимка каталога за день,
 *                             по умолчанию 9; -1 — выключить снимки совсем
 *   LIEFERANDO_CATALOG_EVERY_MIN — как часто обновлять снимок в течение дня,
 *                             по умолчанию 60; 0 — только раз в день
 *   HEADLESS                — 1 (по умолч.) без окна; 0 — с окном, если
 *                             ботозащита Hub не пускает headless
 *
 * Первичная настройка на ПК: npm install; npx playwright install chromium;
 * node toggle.mjs login (вход в Partner Hub один раз).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  STATE_DIR,
  catalogDue,
  loadDotEnv,
  localDayHour,
  postCatalog,
  runCatalog,
  runOff,
  runOn,
  runSet,
} from './core.mjs';

loadDotEnv();

const API_BASE_URL = (process.env.API_BASE_URL || 'https://www.dumbospizza.de').replace(/\/$/, '');
const SECRET = process.env.LIEFERANDO_AGENT_SECRET || process.env.PRINT_AGENT_SECRET || '';
const AGENT_ID = process.env.LIEFERANDO_AGENT_ID || os.hostname();
const POLL_MS = Math.max(5000, Number(process.env.LIEFERANDO_POLL_MS) || 20000);
const HEADLESS = process.env.HEADLESS !== '0';
const CATALOG_HOUR = process.env.LIEFERANDO_CATALOG_HOUR == null || process.env.LIEFERANDO_CATALOG_HOUR === ''
  ? 9
  : Number(process.env.LIEFERANDO_CATALOG_HOUR);
const CATALOG_EVERY_MIN =
  process.env.LIEFERANDO_CATALOG_EVERY_MIN == null || process.env.LIEFERANDO_CATALOG_EVERY_MIN === ''
    ? 60
    : Math.max(0, Number(process.env.LIEFERANDO_CATALOG_EVERY_MIN) || 0);
const CATALOG_TZ = process.env.LIEFERANDO_TZ || 'Europe/Berlin';

if (!SECRET) {
  console.error('Нет секрета: задайте LIEFERANDO_AGENT_SECRET (или PRINT_AGENT_SECRET).');
  process.exit(1);
}

const ts = () => new Date().toLocaleTimeString('ru-RU');
const log = (...a) => console.log(`[${ts()}]`, ...a);

// --- самообновление ------------------------------------------------------------
// Раз в час (и при старте) сверяем свои файлы с /api/lieferando/agent/files.
// Изменившиеся скачиваем, проверяем хэш и node --check, подменяем и выходим —
// start-agent.bat перезапустит агента уже на новом коде. Запуск голым
// `node agent.mjs` тоже работает, но после обновления агент завершится
// и его надо будет запустить заново (поэтому — bat!).
const AGENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const AGENT_FILES = ['agent.mjs', 'core.mjs', 'toggle.mjs'];
const UPDATE_CHECK_MS = 60 * 60 * 1000;
const SELF_UPDATE = process.env.LIEFERANDO_NO_SELF_UPDATE !== '1';

// та же схема, что на сервере: sha256 от байтов, первые 12 hex
const hash12 = (data) => crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);

function localFileHash(name) {
  try {
    return hash12(fs.readFileSync(path.join(AGENT_DIR, name)));
  } catch {
    return null;
  }
}

function localVersion() {
  const files = {};
  for (const f of AGENT_FILES) files[f] = { hash: localFileHash(f) };
  return hash12(AGENT_FILES.map((f) => `${f}:${files[f].hash}`).join('\n'));
}

/** true = обновились, нужен перезапуск. Бросает при сетевых/проверочных сбоях. */
async function checkForUpdates() {
  const res = await fetch(`${API_BASE_URL}/api/lieferando/agent/files`, { headers: HEADERS });
  if (!res.ok) throw new Error(`GET files ${res.status}`);
  const manifest = await res.json();
  const changed = AGENT_FILES.filter(
    (f) => manifest.files?.[f]?.hash && manifest.files[f].hash !== localFileHash(f)
  );
  if (!changed.length) return false;

  log(`Доступно обновление (${changed.join(', ')}, версия ${manifest.version}) — скачиваю…`);
  const staged = [];
  try {
    for (const f of changed) {
      const r = await fetch(
        `${API_BASE_URL}/api/lieferando/agent/files?file=${encodeURIComponent(f)}`,
        { headers: HEADERS }
      );
      if (!r.ok) throw new Error(`GET ${f}: ${r.status}`);
      const buf = Buffer.from(await r.text(), 'utf8');
      if (hash12(buf) !== manifest.files[f].hash) {
        throw new Error(`${f}: хэш не совпал с манифестом (обрыв скачивания?)`);
      }
      const tmp = path.join(AGENT_DIR, `${f}.new.mjs`);
      fs.writeFileSync(tmp, buf);
      const check = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
      if (check.status !== 0) {
        fs.rmSync(tmp, { force: true });
        throw new Error(`${f}: не прошёл node --check: ${(check.stderr || '').slice(0, 200)}`);
      }
      staged.push([tmp, path.join(AGENT_DIR, f)]);
    }
  } catch (e) {
    for (const [tmp] of staged) fs.rmSync(tmp, { force: true });
    throw e;
  }
  // все файлы скачаны и проверены — подменяем разом
  for (const [tmp, dest] of staged) fs.renameSync(tmp, dest);
  log(`Обновление применено (версия ${manifest.version}) — перезапуск агента.`);
  return true;
}

const HEADERS = {
  'X-Lieferando-Agent-Key': SECRET,
  'X-Lieferando-Agent-Id': AGENT_ID,
  'X-Agent-Version': '',
  // умеем цели size/item и снимок каталога — без этого сервер отдаёт только команды MakiLove
  'X-Agent-Caps': 'targets catalog',
  'Content-Type': 'application/json',
};
HEADERS['X-Agent-Version'] = localVersion();

async function poll() {
  const res = await fetch(`${API_BASE_URL}/api/lieferando/agent`, { headers: HEADERS });
  if (!res.ok) throw new Error(`GET ${res.status}`);
  const data = await res.json();
  return data?.command || null;
}

async function report(result) {
  const res = await fetch(`${API_BASE_URL}/api/lieferando/agent`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(result),
  });
  if (!res.ok) throw new Error(`POST ${res.status}`);
}

const describeTarget = (t) =>
  t.kind === 'size'
    ? `размер «${t.label}»`
    : t.kind === 'item'
      ? `позиции: ${t.names.join(', ')}`
      : t.kind === 'catalog'
        ? 'снимок каталога'
        : 'MakiLove';

/** Диспетчер по виду цели. Команда без target — старый формат, т.е. MakiLove. */
function runCommand(command) {
  const target = command.target || { kind: 'makilove' };
  if (target.kind === 'makilove') {
    return (command.action === 'off' ? runOff : runOn)({ headless: HEADLESS, log });
  }
  return runSet({ target, available: command.action === 'on', headless: HEADLESS, log });
}

async function execute(command) {
  const target = command.target || { kind: 'makilove' };
  log(`Команда: ${command.action} — ${describeTarget(target)} (id ${command.id})`);
  if (target.kind === 'catalog') {
    // Снимок уходит на свой эндпоинт; он же закрывает команду в очереди по id.
    await takeCatalog({ id: command.id, reason: 'command' });
    return;
  }
  let result;
  try {
    const r = await runCommand(command);
    result = { id: command.id, action: command.action, target, ...r };
  } catch (e) {
    log('ОШИБКА выполнения:', e.message);
    result = {
      id: command.id,
      action: command.action,
      target,
      ok: false,
      count: 0,
      failed: 0,
      message: e.message?.slice(0, 300) || 'неизвестная ошибка',
    };
  }
  try {
    await report(result);
    log(`Отчёт отправлен: ok=${result.ok}, count=${result.count}`);
  } catch (e) {
    log('Не смог отправить отчёт:', e.message);
  }
}

// --- снимок каталога -------------------------------------------------------------

/**
 * Снять каталог и отправить на сервер. Сбой снятия (сессия истекла, Hub лёг)
 * тоже уходит на сервер — он напишет в группу; сбой отправки — только в лог
 * (команда из очереди протухнет и будет отдана заново, ежедневный снимок
 * повторится завтра).
 */
async function takeCatalog({ id = null, reason }) {
  // любой снимок (и по кнопке бота) сдвигает таймер обновления
  lastCatalogAt = Date.now();
  writeCatalogMark();
  let body;
  try {
    const snap = await runCatalog({ headless: HEADLESS, log });
    body = {
      ok: snap.ok,
      takenAt: snap.takenAt,
      categories: snap.categories,
      failedCategories: snap.failedCategories,
      error: snap.ok ? '' : snap.message || 'каталог пуст',
    };
  } catch (e) {
    log('ОШИБКА снимка каталога:', e.message);
    body = { ok: false, error: e.message?.slice(0, 300) || 'неизвестная ошибка' };
  }
  try {
    await postCatalog(
      { ...body, id, reason, agentId: AGENT_ID },
      { apiBaseUrl: API_BASE_URL, secret: SECRET, agentId: AGENT_ID, version: HEADERS['X-Agent-Version'] }
    );
    log(`Снимок каталога отправлен: ok=${body.ok}${body.ok ? `, категорий ${body.categories.length}` : ''}`);
  } catch (e) {
    log('Не смог отправить снимок каталога:', e.message);
  }
}

// День первого снимка и время последнего помним и в файле — перезапуск агента
// (самообновление) не должен снимать каталог лишний раз.
const CATALOG_DAY_FILE = path.join(STATE_DIR, 'catalog-day.json');

function readCatalogMark() {
  try {
    const raw = JSON.parse(fs.readFileSync(CATALOG_DAY_FILE, 'utf8'));
    return {
      day: typeof raw?.day === 'string' ? raw.day : '',
      at: Number.isFinite(raw?.at) ? Number(raw.at) : 0,
    };
  } catch {
    return { day: '', at: 0 };
  }
}

function writeCatalogMark() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(CATALOG_DAY_FILE, JSON.stringify({ day: lastCatalogDay, at: lastCatalogAt }));
  } catch (e) {
    log('Не смог записать отметку снимка каталога:', e.message);
  }
}

let { day: lastCatalogDay, at: lastCatalogAt } = readCatalogMark();

/** Пора ли снимать каталог сейчас ('daily' | 'refresh' | null) — правило в core.mjs catalogDue. */
const catalogDueNow = () =>
  catalogDue({
    hourFrom: CATALOG_HOUR,
    everyMin: CATALOG_EVERY_MIN,
    lastDay: lastCatalogDay,
    lastAt: lastCatalogAt,
    timeZone: CATALOG_TZ,
  });

async function scheduledCatalog(reason) {
  // отметку ставим ДО запуска: упавший снимок не должен зациклить агента
  lastCatalogDay = localDayHour(new Date(), CATALOG_TZ).day;
  log(
    reason === 'daily'
      ? `Ежедневный снимок каталога (${CATALOG_HOUR}:00 ${CATALOG_TZ})…`
      : `Обновление снимка каталога (каждые ${CATALOG_EVERY_MIN} мин)…`
  );
  await takeCatalog({ reason });
}

log(
  `Агент Lieferando запущен: ${API_BASE_URL}, id=${AGENT_ID}, v=${HEADERS['X-Agent-Version']}, poll=${POLL_MS}ms, headless=${HEADLESS}, автообновление=${SELF_UPDATE ? 'вкл' : 'ВЫКЛ'}, каталог=${CATALOG_HOUR >= 0 ? `с ${CATALOG_HOUR}:00 ${CATALOG_TZ}${CATALOG_EVERY_MIN ? `, каждые ${CATALOG_EVERY_MIN} мин` : ''}` : 'выкл'}`
);
// Простой последовательный цикл: пока команда выполняется — не поллим.
let nextUpdateCheckAt = 0; // первый раз — сразу при старте
for (;;) {
  if (SELF_UPDATE && Date.now() >= nextUpdateCheckAt) {
    nextUpdateCheckAt = Date.now() + UPDATE_CHECK_MS;
    try {
      if (await checkForUpdates()) process.exit(0); // start-agent.bat перезапустит
    } catch (e) {
      log('Проверка обновлений не удалась:', e.message); // не мешаем основной работе
    }
  }
  try {
    const command = await poll();
    if (command) await execute(command);
    else {
      const due = catalogDueNow(); // только при пустой очереди — команды важнее
      if (due) await scheduledCatalog(due);
    }
  } catch (e) {
    log('Поллинг не удался:', e.message); // сеть/деплой — просто ждём следующего тика
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
