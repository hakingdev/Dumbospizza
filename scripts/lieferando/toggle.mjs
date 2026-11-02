/**
 * Ручной CLI управления позициями MakiLove в Lieferando Partner Hub.
 * Вся логика — в core.mjs (её же использует agent.mjs).
 *
 *   node toggle.mjs login                 — войти вручную (сессия сохранится в profile/)
 *   node toggle.mjs list                  — DRY RUN: показать позиции и состояние
 *   node toggle.mjs off                   — выключить все включённые позиции MakiLove
 *   node toggle.mjs on                    — включить все позиции MakiLove
 *   node toggle.mjs export-session [файл] — выгрузить сессию Hub (по умолч. session.json)
 *   node toggle.mjs import-session [файл] — загрузить сессию на этой машине и проверить вход
 *
 * HEADLESS=1 — без окна (на Linux без дисплея включается само).
 */
import {
  defaultHeadless,
  exportSession,
  importSession,
  runList,
  runLogin,
  runOff,
  runOn,
} from './core.mjs';

const cmd = process.argv[2];
const arg = process.argv[3];
const headless = defaultHeadless();
const commands = {
  login: runLogin,
  list: () => runList({ headless }),
  off: async () => {
    const r = await runOff({ headless });
    console.log('Включить обратно: node toggle.mjs on');
    return r;
  },
  on: () => runOn({ headless }),
  'export-session': () => exportSession({ file: arg || 'session.json' }),
  'import-session': () => importSession({ file: arg || 'session.json', headless }),
};
if (!commands[cmd]) {
  console.log('Использование: node toggle.mjs <login|list|off|on|export-session|import-session>');
  process.exit(1);
}
await commands[cmd]();
