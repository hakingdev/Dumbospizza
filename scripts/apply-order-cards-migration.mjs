/**
 * Идемпотентно применяет миграцию 0015: таблица order_cards — где сейчас лежит
 * карточка заказа в Telegram-форуме (тема, message_id, статус, хронология).
 *
 * Почему не `drizzle-kit migrate`: журнал миграций в БД не вёлся (базовые
 * таблицы создавались через db:push), поэтому blanket-migrate попытается
 * накатить 0000+ заново и упадёт на «table already exists» — та же причина,
 * что у apply-migration-0014.mjs и apply-print-seq-migration.mjs.
 *
 * Запуск: node scripts/apply-order-cards-migration.mjs
 * (DATABASE_URL из окружения либо из .env.local / .env)
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import postgres from 'postgres';

function getDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of ['.env.local', '.env']) {
    try {
      const txt = readFileSync(resolve(process.cwd(), file), 'utf8');
      const line = txt.split('\n').find((l) => l.trim().startsWith('DATABASE_URL='));
      if (line) return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
    } catch {
      /* файла может не быть */
    }
  }
  return null;
}

const url = getDatabaseUrl();
if (!url) {
  console.error('DATABASE_URL не найден (.env.local / .env)');
  process.exit(1);
}

const sql = postgres(url, { prepare: false });

try {
  await sql`
    CREATE TABLE IF NOT EXISTS "order_cards" (
      "order_id" text PRIMARY KEY NOT NULL,
      "order_number" text NOT NULL,
      "chat_id" text NOT NULL,
      "message_id" bigint NOT NULL,
      "topic_id" integer NOT NULL,
      "status" text NOT NULL,
      "courier" text,
      "status_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "order_cards_order_number_uq"
    ON "order_cards" USING btree ("order_number")
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS "order_cards_status_idx"
    ON "order_cards" USING btree ("status")
  `;

  const columns = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'order_cards'
    ORDER BY ordinal_position
  `;
  if (!columns.length) {
    console.error('Таблица order_cards не создана!');
    process.exit(1);
  }
  console.log('✓ order_cards:', columns.map((c) => `${c.column_name}:${c.data_type}`).join(', '));
  console.log('Готово: миграция 0015 применена (идемпотентно).');
} catch (e) {
  console.error('Ошибка применения миграции:', e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
