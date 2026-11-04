/**
 * Ручной CLI управления доступностью позиций в Lieferando Partner Hub.
 * Вся логика — в core.mjs (её же использует agent.mjs).
 *
 *   node toggle.mjs login                 — войти вручную (сессия сохранится в profile/)
 *   node toggle.mjs list                  — DRY RUN: показать позиции MakiLove и состояние
 *   node toggle.mjs off                   — выключить все включённые позиции MakiLove
 *   node toggle.mjs on                    — включить все позиции MakiLove
 *   node toggle.mjs find-size "30 cm"     — DRY RUN: где есть такой размер и что бы переключилось
 *   node toggle.mjs set-size "30 cm" off|on         — выключить/включить размер у всех строк вне MakiLove
 *   node toggle.mjs find-item "Hawaiian"  — DRY RUN: какие Hub-строки совпадают с именем сайта
 *   node toggle.mjs set-item "Hawaiian[,Margherita]" off|on — общий переключатель этих строк
 *   node toggle.mjs catalog [--post]      — снимок всего каталога Hub (ничего не переключает)
 *                                           → state/catalog.json; --post — ещё и на сервер
 *                                           (нужны секрет и API_BASE_URL, как у агента)
 *   node toggle.mjs export-session [файл] — выгрузить сессию Hub (по умолч. session.json)
 *   node toggle.mjs import-session [файл] — загрузить сессию на этой машине и проверить вход
 *
 * HEADLESS=1 — без окна (на Linux без дисплея включается само).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  STATE_DIR,
  defaultHeadless,
  exportSession,
  importSession,
  loadDotEnv,
  postCatalog,
  runCatalog,
  runList,
  runLogin,
  runOff,
  runOn,
  runSet,
} from './core.mjs';

loadDotEnv();

const [, , cmd, ...rest] = process.argv;
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const [arg, arg2] = rest.filter((a) => !a.startsWith('--'));
const headless = defaultHeadless();

const USAGE =
  'Использование: node toggle.mjs <login|list|off|on|catalog [--post]|export-session|import-session>\n' +
  '               node toggle.mjs find-size "30 cm" | set-size "30 cm" off|on\n' +
  '               node toggle.mjs find-item "Hawaiian[,…]" | set-item "Hawaiian[,…]" off|on';

const need = (value, what) => {
  if (!value || !String(value).trim()) {
    console.log(`Не хватает аргумента: ${what}\n${USAGE}`);
    process.exit(1);
  }
  return String(value).trim();
};
const availableArg = (value) => {
  if (value !== 'off' && value !== 'on') {
    console.log(`Последний аргумент должен быть off или on\n${USAGE}`);
    process.exit(1);
  }
  return value === 'on';
};
const sizeTarget = () => ({ kind: 'size', label: need(arg, 'подпись размера, например "30 cm"') });
const itemTarget = () => ({
  kind: 'item',
  names: need(arg, 'имя позиции (несколько — через запятую)')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
});

/** Снимок каталога: в state/catalog.json и, с --post, на сервер (как делает агент). */
async function catalog() {
  const snap = await runCatalog({ headless });
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const file = path.join(STATE_DIR, 'catalog.json');
  fs.writeFileSync(file, JSON.stringify(snap, null, 2));
  console.log(`Снимок сохранён: ${file}`);
  if (!flags.has('--post')) return snap;

  const secret = process.env.LIEFERANDO_AGENT_SECRET || process.env.PRINT_AGENT_SECRET || '';
  const apiBaseUrl = process.env.API_BASE_URL || 'https://www.dumbospizza.de';
  if (!secret) {
    console.log('--post: нет секрета (LIEFERANDO_AGENT_SECRET или PRINT_AGENT_SECRET) — не отправляю.');
    process.exitCode = 1;
    return snap;
  }
  const agentId = process.env.LIEFERANDO_AGENT_ID || os.hostname();
  const res = await postCatalog(
    {
      reason: 'cli',
      agentId,
      ok: snap.ok,
      takenAt: snap.takenAt,
      categories: snap.categories,
      failedCategories: snap.failedCategories,
      error: snap.ok ? '' : snap.message,
    },
    { apiBaseUrl, secret, agentId }
  );
  console.log(`Отправлено на ${apiBaseUrl}:`, JSON.stringify(res));
  return snap;
}

const commands = {
  login: runLogin,
  list: () => runList({ headless }),
  off: async () => {
    const r = await runOff({ headless });
    console.log('Включить обратно: node toggle.mjs on');
    return r;
  },
  on: () => runOn({ headless }),
  'find-size': () => runSet({ target: sizeTarget(), available: false, dryRun: true, headless }),
  'set-size': () => runSet({ target: sizeTarget(), available: availableArg(arg2), headless }),
  'find-item': () => runSet({ target: itemTarget(), available: false, dryRun: true, headless }),
  'set-item': () => runSet({ target: itemTarget(), available: availableArg(arg2), headless }),
  catalog,
  'export-session': () => exportSession({ file: arg || 'session.json' }),
  'import-session': () => importSession({ file: arg || 'session.json', headless }),
};
if (!commands[cmd]) {
  console.log(USAGE);
  process.exit(1);
}
await commands[cmd]();
