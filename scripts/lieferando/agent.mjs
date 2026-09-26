/**
 * Агент Lieferando для кассового ПК — исполнитель команд стоп-бота.
 *
 * Поллит GET /api/lieferando/agent (раз в POLL_MS); получив команду off/on,
 * прокликивает позиции MakiLove в Partner Hub (core.mjs) и отчитывается
 * POST'ом — сервер шлёт итог в Telegram-группу стоп-бота.
 *
 * env (можно в .env рядом, см. README):
 *   LIEFERANDO_AGENT_SECRET — общий секрет (или PRINT_AGENT_SECRET, как у печати)
 *   API_BASE_URL            — по умолчанию https://www.dumbospizza.de (строго www!
 *                             apex отвечает 308 и POST теряется — как у print-agent)
 *   LIEFERANDO_POLL_MS      — период поллинга, по умолчанию 20000
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
import { runOff, runOn } from './core.mjs';

// .env рядом со скриптом (KEY=value построчно) — чтобы на кассовом ПК не
// настраивать переменные окружения; реальный env имеет приоритет.
try {
  const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env');
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  /* .env нет — ок, работаем от переменных окружения */
}

const API_BASE_URL = (process.env.API_BASE_URL || 'https://www.dumbospizza.de').replace(/\/$/, '');
const SECRET = process.env.LIEFERANDO_AGENT_SECRET || process.env.PRINT_AGENT_SECRET || '';
const AGENT_ID = process.env.LIEFERANDO_AGENT_ID || os.hostname();
const POLL_MS = Math.max(5000, Number(process.env.LIEFERANDO_POLL_MS) || 20000);
const HEADLESS = process.env.HEADLESS !== '0';

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
      const tmp = path.join(AGENT_DIR, `${f}.new`);
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

async function execute(command) {
  log(`Команда: ${command.action} (id ${command.id})`);
  let result;
  try {
    const run = command.action === 'off' ? runOff : runOn;
    const r = await run({ headless: HEADLESS, log });
    result = { id: command.id, action: command.action, ...r };
  } catch (e) {
    log('ОШИБКА выполнения:', e.message);
    result = {
      id: command.id,
      action: command.action,
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

log(
  `Агент Lieferando запущен: ${API_BASE_URL}, id=${AGENT_ID}, v=${HEADERS['X-Agent-Version']}, poll=${POLL_MS}ms, headless=${HEADLESS}, автообновление=${SELF_UPDATE ? 'вкл' : 'ВЫКЛ'}`
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
  } catch (e) {
    log('Поллинг не удался:', e.message); // сеть/деплой — просто ждём следующего тика
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
