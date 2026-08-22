/**
 * Создание тем форума в группе заказов — ОДИН раз при переходе на режим тем.
 *
 * Бот темы НЕ создаёт при заказах: их id живут в конфиге (storeSettings или
 * env). Этот скрипт создаёт четыре обязательные темы (плюс опциональную для
 * отмен) и печатает готовые строки для .env / storeSettings.
 *
 * Перед запуском: включить в группе режим Topics (Настройки группы → Темы)
 * и выдать боту права Manage Topics / Delete Messages / Post Messages.
 *
 * Запуск:
 *   node scripts/telegram-topics.mjs create            — создать темы и напечатать id
 *   node scripts/telegram-topics.mjs create --cancelled — плюс отдельная тема «Отменён»
 *   node scripts/telegram-topics.mjs create --save     — сразу записать id в storeSettings
 *   node scripts/telegram-topics.mjs create-archive [--save] — ТОЛЬКО тема «🗂 Архив»
 *       (для групп, где основные темы уже созданы; ночная уборка начнёт
 *        переносить старые карточки туда вместо удаления)
 *   node scripts/telegram-topics.mjs check             — показать, что сейчас в конфиге
 *
 * ВНИМАНИЕ: Bot API не умеет перечислять существующие темы, поэтому повторный
 * `create` СОЗДАСТ ДУБЛИ. Запускай один раз; если промахнулся — удали лишние
 * темы в интерфейсе Telegram.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import postgres from 'postgres';

const TOPICS = [
  { key: 'cooking', name: '🔥 Готовится', env: 'TELEGRAM_TOPIC_COOKING', setting: 'telegramTopicCooking' },
  { key: 'ready', name: '🚚 Доставка', env: 'TELEGRAM_TOPIC_READY', setting: 'telegramTopicReady' },
  { key: 'on_the_way', name: '🚗 В пути', env: 'TELEGRAM_TOPIC_ON_THE_WAY', setting: 'telegramTopicOnTheWay' },
  { key: 'delivered', name: '✅ Доставлен', env: 'TELEGRAM_TOPIC_DELIVERED', setting: 'telegramTopicDelivered' },
];

const CANCELLED_TOPIC = {
  key: 'cancelled',
  name: '❌ Отменён',
  env: 'TELEGRAM_TOPIC_CANCELLED',
  setting: 'telegramTopicCancelled',
};

const ARCHIVE_TOPIC = {
  key: 'archive',
  name: '🗂 Архив',
  env: 'TELEGRAM_TOPIC_ARCHIVE',
  setting: 'telegramTopicArchive',
};

function loadEnvFiles() {
  for (const file of ['.env.local', '.env']) {
    try {
      const txt = readFileSync(resolve(process.cwd(), file), 'utf8');
      for (const line of txt.split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !process.env[m[1]]) {
          process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
        }
      }
    } catch {
      /* файла может не быть */
    }
  }
}

async function loadConfig() {
  loadEnvFiles();
  let token = process.env.TELEGRAM_BOT_TOKEN || '';
  let chatId = process.env.TELEGRAM_CHAT_ID || '';
  let settings = {};

  if (process.env.DATABASE_URL) {
    const sql = postgres(process.env.DATABASE_URL, { prepare: false });
    try {
      const rows = await sql`select value from settings where key='storeSettings'`;
      settings = rows[0]?.value || {};
      token = settings.telegramBotToken || token;
      chatId = String(settings.telegramChatId || chatId);
    } finally {
      await sql.end();
    }
  }

  if (!token) throw new Error('Не найден telegramBotToken (storeSettings) / TELEGRAM_BOT_TOKEN');
  if (!chatId) throw new Error('Не найден telegramChatId (storeSettings) / TELEGRAM_CHAT_ID');
  return { token, chatId, settings };
}

async function tg(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method}: ${json.description || res.status}`);
  return json.result;
}

async function saveSettings(patch) {
  if (!process.env.DATABASE_URL) {
    throw new Error('--save требует DATABASE_URL (запись в storeSettings)');
  }
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const rows = await sql`select value from settings where key='storeSettings'`;
    const next = { ...(rows[0]?.value || {}), ...patch };
    await sql`update settings set value = ${sql.json(next)}, updated_at = now() where key='storeSettings'`;
    console.log('✓ storeSettings обновлены:', Object.keys(patch).join(', '));
  } finally {
    await sql.end();
  }
}

async function create({ token, chatId }, { withCancelled, save }) {
  const wanted = withCancelled ? [...TOPICS, CANCELLED_TOPIC] : TOPICS;
  const patch = {};
  const envLines = [];

  for (const topic of wanted) {
    const result = await tg(token, 'createForumTopic', { chat_id: chatId, name: topic.name });
    const id = result.message_thread_id;
    patch[topic.setting] = id;
    envLines.push(`${topic.env}=${id}`);
    console.log(`✓ ${topic.name} → message_thread_id=${id}`);
    // Держим паузу: createForumTopic тоже попадает под лимит группы.
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log('\n--- .env / Vercel ---');
  console.log('TELEGRAM_FORUM_ENABLED=true');
  envLines.forEach((l) => console.log(l));

  if (save) {
    await saveSettings({ ...patch, telegramForumEnabled: true });
  } else {
    console.log('\n(добавь строки в окружение или перезапусти с --save для записи в storeSettings)');
  }

  console.log('\nДальше: npx tsx scripts/migrate-telegram-forum-cards.ts --dry-run');
}

/** Одна тема «🗂 Архив» поверх уже созданных: боевую группу пересоздавать не надо. */
async function createArchive({ token, chatId, settings }, { save }) {
  const existing = settings[ARCHIVE_TOPIC.setting] ?? process.env[ARCHIVE_TOPIC.env];
  if (existing) {
    console.log(`Тема архива уже настроена: message_thread_id=${existing} — второй раз не создаю.`);
    return;
  }

  const result = await tg(token, 'createForumTopic', { chat_id: chatId, name: ARCHIVE_TOPIC.name });
  const id = result.message_thread_id;
  console.log(`✓ ${ARCHIVE_TOPIC.name} → message_thread_id=${id}`);
  console.log('\n--- .env / Vercel ---');
  console.log(`${ARCHIVE_TOPIC.env}=${id}`);

  if (save) {
    await saveSettings({ [ARCHIVE_TOPIC.setting]: id });
  } else {
    console.log('\n(добавь строку в окружение или перезапусти с --save для записи в storeSettings)');
  }

  console.log('\nСо следующей ночной уборки старые карточки поедут в архив вместо удаления.');
}

function check({ settings }) {
  const rows = [...TOPICS, CANCELLED_TOPIC, ARCHIVE_TOPIC].map((t) => ({
    тема: t.name,
    storeSettings: settings[t.setting] ?? '—',
    env: process.env[t.env] ?? '—',
  }));
  console.table(rows);
  console.log(
    'Режим форума:',
    settings.telegramForumEnabled ?? process.env.TELEGRAM_FORUM_ENABLED ?? 'выключен'
  );
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'check';
  const config = await loadConfig();
  console.log(`chatId: ${config.chatId}\n`);

  if (cmd === 'create') {
    await create(config, {
      withCancelled: args.includes('--cancelled'),
      save: args.includes('--save'),
    });
    return;
  }
  if (cmd === 'create-archive') {
    await createArchive(config, { save: args.includes('--save') });
    return;
  }
  if (cmd === 'check') {
    check(config);
    return;
  }
  console.log('Команды: create [--cancelled] [--save] | create-archive [--save] | check');
}

main().catch((e) => {
  console.error('ОШИБКА:', e.message || e);
  process.exit(1);
});
