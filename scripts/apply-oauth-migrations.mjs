/**
 * Идемпотентно создаёт таблицу привязок внешнего входа (user_identities +
 * индексы) из миграции 0010.
 *
 * Почему не `drizzle-kit migrate`: журнал миграций в БД не вёлся (базовые
 * таблицы созданы через `db:push`) → blanket-migrate упал бы на
 * "table already exists" (тот же случай, что apply-banner-migrations.mjs).
 * Здесь только CREATE TABLE/INDEX IF NOT EXISTS — безопасно, аддитивно,
 * повторяемо.
 *
 * Запуск: node scripts/apply-oauth-migrations.mjs
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
  // --- user_identities (миграция 0010) ---
  await sql`CREATE TABLE IF NOT EXISTS "user_identities" (
    "id" text PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL,
    "provider" text NOT NULL,
    "subject" text NOT NULL,
    "email" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  )`;
  console.log('✓ user_identities');

  // Одна учётка Google/Apple → ровно один наш аккаунт.
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS "user_identities_provider_subject_uq"
    ON "user_identities" USING btree ("provider","subject")`;
  console.log('✓ user_identities_provider_subject_uq');

  await sql`CREATE INDEX IF NOT EXISTS "user_identities_user_idx"
    ON "user_identities" USING btree ("user_id")`;
  console.log('✓ user_identities_user_idx');

  console.log('\nГотово — таблица привязок внешнего входа применена.');
} catch (err) {
  console.error('Ошибка применения миграции:', err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
