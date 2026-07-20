/**
 * Идемпотентно создаёт таблицу рекламных баннеров главной из миграции 0008
 * (homepage_banners + индекс) и переводит её на расписание по дням недели
 * из 0009 (active_days_of_week / schedule_time_zone вместо valid_from/valid_to).
 *
 * Почему не `drizzle-kit migrate`: журнал миграций в БД не вёлся (базовые
 * таблицы созданы через `db:push`) → blanket-migrate упал бы на
 * "table already exists" (тот же случай, что apply-paypal-migrations.mjs).
 * Здесь только CREATE TABLE/INDEX IF NOT EXISTS — безопасно, аддитивно,
 * повторяемо.
 *
 * Запуск: node scripts/apply-banner-migrations.mjs
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
  // --- homepage_banners (миграция 0008) ---
  await sql`CREATE TABLE IF NOT EXISTS "homepage_banners" (
    "id" text PRIMARY KEY NOT NULL,
    "title" text NOT NULL,
    "subtitle" text,
    "image" text NOT NULL,
    "link_url" text,
    "badge_text" text,
    "enabled" boolean DEFAULT true NOT NULL,
    "order" integer DEFAULT 0 NOT NULL,
    "valid_from" timestamp with time zone,
    "valid_to" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  )`;
  console.log('✓ homepage_banners');

  await sql`CREATE INDEX IF NOT EXISTS "homepage_banners_active_idx"
    ON "homepage_banners" USING btree ("enabled","order")`;
  console.log('✓ homepage_banners_active_idx');

  // --- расписание по дням недели вместо окна дат (миграция 0009) ---
  await sql`ALTER TABLE "homepage_banners"
    ADD COLUMN IF NOT EXISTS "active_days_of_week" jsonb NOT NULL DEFAULT '[0,1,2,3,4,5,6]'::jsonb`;
  console.log('✓ homepage_banners.active_days_of_week');

  await sql`ALTER TABLE "homepage_banners"
    ADD COLUMN IF NOT EXISTS "schedule_time_zone" text NOT NULL DEFAULT 'Europe/Berlin'`;
  console.log('✓ homepage_banners.schedule_time_zone');

  // Окно дат уходит: приложение его больше не читает и не показывает в админке,
  // а невидимый фильтр в БД молча прятал бы баннеры. Сначала показываем, что теряем.
  const [{ count: withDates }] = await sql`
    SELECT count(*)::int AS count FROM information_schema.columns
    WHERE table_name = 'homepage_banners' AND column_name IN ('valid_from', 'valid_to')`;

  if (withDates > 0) {
    const stale = await sql`
      SELECT "title", "valid_from", "valid_to" FROM "homepage_banners"
      WHERE "valid_from" IS NOT NULL OR "valid_to" IS NOT NULL`;
    for (const row of stale) {
      console.log(
        `  ⚠ «${row.title}»: окно ${row.valid_from?.toISOString().slice(0, 10) ?? '—'} … ` +
          `${row.valid_to?.toISOString().slice(0, 10) ?? '—'} удаляется, ` +
          `баннер переходит на «каждый день» — проверьте дни в админке`
      );
    }

    await sql`ALTER TABLE "homepage_banners" DROP COLUMN IF EXISTS "valid_from"`;
    await sql`ALTER TABLE "homepage_banners" DROP COLUMN IF EXISTS "valid_to"`;
    console.log('✓ homepage_banners.valid_from / valid_to удалены');
  }

  console.log('\nГотово — таблица баннеров применена.');
} catch (err) {
  console.error('Ошибка применения миграции:', err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
