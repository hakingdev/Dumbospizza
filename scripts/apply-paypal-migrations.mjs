/**
 * Идемпотентно создаёт таблицы PayPal-платежей из миграции 0007:
 * payments, payment_events, refunds (+ индексы).
 *
 * Почему не `drizzle-kit migrate`: журнал миграций в БД не вёлся (базовые
 * таблицы созданы через `db:push`) → blanket-migrate упал бы на
 * "table already exists" (тот же случай, что apply-account-migrations.mjs).
 * Здесь только CREATE TABLE/INDEX IF NOT EXISTS — безопасно, аддитивно,
 * повторяемо.
 *
 * Запуск: node scripts/apply-paypal-migrations.mjs
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
  // --- payments (миграция 0007) ---
  await sql`CREATE TABLE IF NOT EXISTS "payments" (
    "id" text PRIMARY KEY NOT NULL,
    "order_id" text NOT NULL,
    "provider" text NOT NULL,
    "provider_order_id" text NOT NULL,
    "provider_capture_id" text,
    "status" text DEFAULT 'created' NOT NULL,
    "amount_minor" integer NOT NULL,
    "currency" text DEFAULT 'EUR' NOT NULL,
    "raw_payload" jsonb,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS "payments_provider_order_uq"
    ON "payments" USING btree ("provider","provider_order_id")`;
  await sql`CREATE INDEX IF NOT EXISTS "payments_order_idx"
    ON "payments" USING btree ("order_id")`;
  await sql`CREATE INDEX IF NOT EXISTS "payments_capture_idx"
    ON "payments" USING btree ("provider_capture_id")`;
  console.log('✓ payments');

  // --- payment_events ---
  await sql`CREATE TABLE IF NOT EXISTS "payment_events" (
    "id" text PRIMARY KEY NOT NULL,
    "provider" text NOT NULL,
    "event_id" text NOT NULL,
    "event_type" text NOT NULL,
    "payload" jsonb,
    "processed_at" timestamp with time zone DEFAULT now() NOT NULL
  )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS "payment_events_provider_event_uq"
    ON "payment_events" USING btree ("provider","event_id")`;
  console.log('✓ payment_events');

  // --- refunds ---
  await sql`CREATE TABLE IF NOT EXISTS "refunds" (
    "id" text PRIMARY KEY NOT NULL,
    "payment_id" text NOT NULL,
    "provider_refund_id" text,
    "request_id" text NOT NULL,
    "amount_minor" integer NOT NULL,
    "status" text DEFAULT 'pending' NOT NULL,
    "reason" text,
    "created_by" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS "refunds_provider_refund_uq"
    ON "refunds" USING btree ("provider_refund_id") WHERE "provider_refund_id" IS NOT NULL`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS "refunds_request_uq"
    ON "refunds" USING btree ("request_id")`;
  await sql`CREATE INDEX IF NOT EXISTS "refunds_payment_idx"
    ON "refunds" USING btree ("payment_id")`;
  console.log('✓ refunds');

  // --- контрольная проверка ---
  const rows = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('payments', 'payment_events', 'refunds')
    ORDER BY table_name`;
  console.log('В БД:', rows.map((r) => r.table_name).join(', '));
  if (rows.length !== 3) {
    console.error('Ожидались 3 таблицы!');
    process.exit(1);
  }
  console.log('Готово: миграция 0007 применена (идемпотентно).');
} catch (e) {
  console.error('Ошибка применения миграции:', e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
