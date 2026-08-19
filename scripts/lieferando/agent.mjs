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
import os from 'node:os';
import { runOff, runOn } from './core.mjs';

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

const HEADERS = {
  'X-Lieferando-Agent-Key': SECRET,
  'X-Lieferando-Agent-Id': AGENT_ID,
  'Content-Type': 'application/json',
};

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

log(`Агент Lieferando запущен: ${API_BASE_URL}, id=${AGENT_ID}, poll=${POLL_MS}ms, headless=${HEADLESS}`);
// Простой последовательный цикл: пока команда выполняется — не поллим.
for (;;) {
  try {
    const command = await poll();
    if (command) await execute(command);
  } catch (e) {
    log('Поллинг не удался:', e.message); // сеть/деплой — просто ждём следующего тика
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
