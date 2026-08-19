/**
 * Ручной CLI управления позициями MakiLove в Lieferando Partner Hub.
 * Вся логика — в core.mjs (её же использует agent.mjs на кассовом ПК).
 *
 *   node toggle.mjs login  — войти вручную (сессия сохранится в profile/)
 *   node toggle.mjs list   — DRY RUN: показать позиции и состояние
 *   node toggle.mjs off    — выключить все включённые позиции MakiLove
 *   node toggle.mjs on     — включить обратно то, что выключал скрипт
 */
import { runLogin, runList, runOff, runOn } from './core.mjs';

const cmd = process.argv[2];
const commands = {
  login: runLogin,
  list: () => runList(),
  off: async () => {
    const r = await runOff();
    console.log('Включить обратно: node toggle.mjs on');
    return r;
  },
  on: () => runOn(),
};
if (!commands[cmd]) {
  console.log('Использование: node toggle.mjs <login|list|off|on>');
  process.exit(1);
}
await commands[cmd]();
