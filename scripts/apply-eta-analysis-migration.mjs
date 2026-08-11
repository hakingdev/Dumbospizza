/**
 * Идемпотентно добавляет orders.eta_analysis (jsonb) — AI-оценка времени заказа
 * (lib/eta/order-eta.ts): разбивка готовка/доставка, расстояние, координаты,
 * уровень загрузки и советы персоналу.
 *
 * Почему не `drizzle-kit migrate`: журнал миграций в БД не вёлся (базовые
 * таблицы созданы через `db:push`) → blanket-migrate упал бы на
 * "table already exists" (тот же случай, что apply-print-seq-migration.mjs).
 *
 * Запуск: node scripts/apply-eta-analysis-migration.mjs
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
    ADD COLUMN IF NOT EXISTS "eta_analysis" jsonb
  `;

  const [col] = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders'
      AND column_name = 'eta_analysis'
  `;
  if (!col) {
    console.error('Колонка eta_analysis не создана!');
    process.exit(1);
  }
  console.log('✓ orders.eta_analysis:', col.data_type, '| nullable', col.is_nullable);
  console.log('Готово: миграция eta_analysis применена (идемпотентно).');
} catch (e) {
  console.error('Ошибка применения миграции:', e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
