/**
 * Идемпотентно применяет миграцию 0012: orders.kitchen_print_seq —
 * номер задания печати кухонного чека (0 — первичная печать, +1 на каждый
 * Nachdruck из админки). Входит в идемпотентный ключ принт-агента, поэтому
 * повторная печать не считается дублем уже напечатанного чека.
 *
 * Почему не `drizzle-kit migrate`: журнал миграций в БД не вёлся (базовые
 * таблицы созданы через `db:push`) → blanket-migrate упал бы на
 * "table already exists" (тот же случай, что apply-paypal-migrations.mjs).
 *
 * Запуск: node scripts/apply-print-seq-migration.mjs
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
  await sql`
    ALTER TABLE "orders"
    ADD COLUMN IF NOT EXISTS "kitchen_print_seq" integer DEFAULT 0 NOT NULL
  `;

  const [col] = await sql`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders'
      AND column_name = 'kitchen_print_seq'
  `;
  if (!col) {
    console.error('Колонка kitchen_print_seq не создана!');
    process.exit(1);
  }
  console.log('✓ orders.kitchen_print_seq:', col.data_type, '| default', col.column_default);
  console.log('Готово: миграция 0012 применена (идемпотентно).');
} catch (e) {
  console.error('Ошибка применения миграции:', e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
