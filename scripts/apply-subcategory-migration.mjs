/**
 * Идемпотентно добавляет колонки подкатегорий (миграция 0011):
 *   categories.subcategories  jsonb  — список меток { id, name, order }
 *   products.subcategory_id   text   — метка товара внутри его категории
 *
 * Почему не `drizzle-kit migrate`: журнал содержит 0000/0001 (создание ВСЕХ
 * базовых таблиц), уже применённых через `db:push` → blanket-migrate упал бы на
 * "table already exists". Здесь только ADD COLUMN IF NOT EXISTS — аддитивно и
 * повторяемо, существующие данные не трогаются.
 *
 * Запуск: node scripts/apply-subcategory-migration.mjs
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
  await sql`ALTER TABLE "categories"
    ADD COLUMN IF NOT EXISTS "subcategories" jsonb DEFAULT '[]'::jsonb NOT NULL`;
  console.log('✓ categories.subcategories');

  await sql`ALTER TABLE "products"
    ADD COLUMN IF NOT EXISTS "subcategory_id" text`;
  console.log('✓ products.subcategory_id');

  console.log('\nГотово — подкатегории применены.');
} catch (err) {
  console.error('Ошибка применения миграции:', err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
