/**
 * Идемпотентно применяет миграцию 0017: orders.client_info (jsonb, NULL) —
 * платформа/версия мобильного приложения для заказов с source='app'
 * (lib/orders/order-client.ts).
 *
 * Применять ДО деплоя кода: новый код пишет client_info при каждом заказе,
 * и без колонки insert упал бы. Старому коду пустая колонка не мешает.
 *
 * Почему не `drizzle-kit migrate`: журнал миграций отстал от прод-схемы
 * (см. apply-print-seq-migration.mjs).
 *
 * Запуск: node scripts/apply-order-client-migration.mjs
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
  await sql`ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "client_info" jsonb`;

  const [col] = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders'
      AND column_name = 'client_info'
  `;
  if (!col) {
    console.error('Колонка client_info не создана!');
    process.exit(1);
  }
  console.log('✓ orders.client_info:', col.data_type, '| nullable', col.is_nullable);
  console.log('Готово: миграция 0017 применена (идемпотентно).');
} catch (e) {
  console.error('Ошибка применения миграции:', e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
