/**
 * Точечное применение миграции 0014 (orders.source + догоняющая orders.eta_analysis)
 * БЕЗ drizzle-kit migrate: прод исторически получал часть колонок через db:push,
 * поэтому полный `npm run db:migrate` может попытаться накатить 0000+ заново.
 * Здесь — ровно два идемпотентных ALTER'а из lib/db/migrations/0014_sturdy_legion.sql.
 *
 * Запуск:  node scripts/apply-migration-0014.mjs
 * DATABASE_URL берётся из окружения или из .env / .env.local в корне проекта.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import postgres from 'postgres';

function loadEnv() {
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

const STATEMENTS = [
  `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "eta_analysis" jsonb`,
  `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'website' NOT NULL`,
];

async function main() {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'DATABASE_URL не задан. Создайте .env в корне проекта со строкой\n' +
        '  DATABASE_URL=postgres://...\n' +
        '(значение — в Vercel → Project → Settings → Environment Variables\n' +
        ' или Supabase → Project Settings → Database → Connection string).'
    );
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, prepare: false });
  try {
    for (const stmt of STATEMENTS) {
      await sql.unsafe(stmt);
      console.log('OK:', stmt);
    }
    const cols = await sql`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'orders' AND column_name IN ('source', 'eta_analysis')
      ORDER BY column_name`;
    console.log('\nПроверка колонок orders:');
    for (const c of cols) {
      console.log(`  ${c.column_name}: ${c.data_type}${c.column_default ? ` default ${c.column_default}` : ''}`);
    }
    if (cols.length === 2) {
      console.log('\n✅ Миграция 0014 применена.');
    } else {
      console.error('\n⚠️ Ожидались 2 колонки, найдено:', cols.length);
      process.exit(1);
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error('Ошибка миграции:', e?.message || e);
  process.exit(1);
});
