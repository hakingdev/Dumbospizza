/**
 * Идемпотентно создаёт таблицы личного кабинета/лояльности, добавленные в
 * фазах MVP + Фаза 2: loyalty_transactions (0002) и customer_notifications (0003).
 *
 * Почему не `drizzle-kit migrate`: журнал содержит 0000/0001 (создание ВСЕХ
 * базовых таблиц), которые уже применены ранее через `db:push` → blanket-migrate
 * упал бы на "table already exists". Здесь применяем ТОЛЬКО две новые таблицы
 * через CREATE TABLE/INDEX IF NOT EXISTS — безопасно, аддитивно, повторяемо.
 *
 * Запуск: node scripts/apply-account-migrations.mjs
 * (читает DATABASE_URL из .env.local или .env)
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
  // --- loyalty_transactions (миграция 0002) ---
  await sql`CREATE TABLE IF NOT EXISTS "loyalty_transactions" (
    "id" text PRIMARY KEY NOT NULL,
    "user" text NOT NULL,
    "order" text,
    "type" text NOT NULL,
    "amount" double precision NOT NULL,
    "delta" double precision NOT NULL,
    "balance_after" double precision DEFAULT 0 NOT NULL,
    "description" text DEFAULT '' NOT NULL,
    "expires_at" timestamp with time zone,
    "consumed" double precision DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  )`;
  await sql`CREATE INDEX IF NOT EXISTS "loyalty_tx_user_idx" ON "loyalty_transactions" USING btree ("user","created_at")`;
  await sql`CREATE INDEX IF NOT EXISTS "loyalty_tx_order_type_idx" ON "loyalty_transactions" USING btree ("order","type")`;
  await sql`CREATE INDEX IF NOT EXISTS "loyalty_tx_expiry_idx" ON "loyalty_transactions" USING btree ("type","expires_at")`;

  // --- customer_notifications (миграция 0003) ---
  await sql`CREATE TABLE IF NOT EXISTS "customer_notifications" (
    "id" text PRIMARY KEY NOT NULL,
    "user" text NOT NULL,
    "title" text NOT NULL,
    "body" text NOT NULL,
    "link" text,
    "link_label" text,
    "category" text DEFAULT 'system' NOT NULL,
    "read" boolean DEFAULT false NOT NULL,
    "read_at" timestamp with time zone,
    "campaign_id" text,
    "audience" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  )`;
  await sql`CREATE INDEX IF NOT EXISTS "cust_notif_user_read_idx" ON "customer_notifications" USING btree ("user","read","created_at")`;
  await sql`CREATE INDEX IF NOT EXISTS "cust_notif_campaign_idx" ON "customer_notifications" USING btree ("campaign_id")`;

  const tables = await sql`
    SELECT table_name, count(*)::int AS columns
    FROM information_schema.columns
    WHERE table_name IN ('loyalty_transactions','customer_notifications')
    GROUP BY table_name ORDER BY table_name`;
  console.log('OK — таблицы на месте:');
  for (const t of tables) console.log(`  ${t.table_name}: ${t.columns} колонок`);
} catch (e) {
  console.error('ОШИБКА:', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
