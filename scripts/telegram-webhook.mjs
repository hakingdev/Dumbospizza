/**
 * Управление webhook Telegram-бота (отдельного скрипта в проекте не было —
 * `setupTelegramWebhook()` в lib/telegram.ts никем не вызывается).
 *
 * Зачем: бот шлёт заказы из любого места, НО нажатия кнопок статуса
 * (Готовится/Готов/В пути/Доставлен/Отменён) Telegram доставляет ТОЛЬКО на
 * зарегистрированный webhook-URL. После переезда нужно указать актуальный URL
 * приложения, иначе кнопки будут писать статус в старую систему.
 *
 * Токен и секрет берутся из storeSettings (Supabase), фолбэк — env.
 *
 * Запуск (DATABASE_URL должен быть в .env или в окружении):
 *   node scripts/telegram-webhook.mjs info
 *   node scripts/telegram-webhook.mjs set https://dumbospizza.de/api/telegram/webhook
 *   node scripts/telegram-webhook.mjs delete
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import postgres from 'postgres';

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    const line = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
    if (line) return line.slice('DATABASE_URL='.length).trim();
  } catch {}
  return '';
}

async function getTelegramConfig() {
  const url = loadDatabaseUrl();
  let token = process.env.TELEGRAM_BOT_TOKEN || '';
  let secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
  let chatId = process.env.TELEGRAM_CHAT_ID || '';
  if (url) {
    const sql = postgres(url, { prepare: false });
    try {
      const r = await sql`select value from settings where key='storeSettings'`;
      const s = r[0]?.value || {};
      token = s.telegramBotToken || token;
      secret = s.telegramWebhookSecret || secret;
      chatId = s.telegramChatId || chatId;
    } finally {
      await sql.end();
    }
  }
  if (!token) throw new Error('Не найден telegramBotToken (ни в storeSettings, ни в env).');
  return { token, secret, chatId };
}

async function tg(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

async function info(token) {
  const j = await tg(token, 'getWebhookInfo');
  console.log(JSON.stringify(j.result, null, 2));
}

async function main() {
  const [cmd, urlArg] = process.argv.slice(2);
  const { token, secret, chatId } = await getTelegramConfig();
  console.log(`bot ok | chatId: ${chatId} | webhookSecret: ${secret ? 'set' : 'EMPTY'}\n`);

  if (cmd === 'info' || !cmd) {
    await info(token);
    return;
  }

  if (cmd === 'set') {
    const url = urlArg || process.env.TELEGRAM_WEBHOOK_URL;
    if (!url) throw new Error('Укажи URL: node scripts/telegram-webhook.mjs set https://.../api/telegram/webhook');
    if (!secret) throw new Error('telegramWebhookSecret пуст в storeSettings — webhook без секрета небезопасен. Заполни его сначала.');
    console.log(`Регистрирую webhook → ${url}`);
    const j = await tg(token, 'setWebhook', {
      url,
      secret_token: secret, // Telegram пришлёт его в заголовке X-Telegram-Bot-Api-Secret-Token
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    });
    console.log('setWebhook:', JSON.stringify(j));
    console.log('\nТекущее состояние:');
    await info(token);
    return;
  }

  if (cmd === 'delete') {
    const j = await tg(token, 'deleteWebhook', { drop_pending_updates: false });
    console.log('deleteWebhook:', JSON.stringify(j));
    return;
  }

  console.log('Команды: info | set <url> | delete');
}

main().catch((e) => {
  console.error('ОШИБКА:', e.message || e);
  process.exit(1);
});
