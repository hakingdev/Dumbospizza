/**
 * Applies lib/db/migrations/0018_push_campaigns.sql (module H «Push») WITHOUT drizzle-kit migrate:
 * the drizzle journal is out of sync with prod (see docs/push-notifications.md).
 * Every statement is idempotent (IF NOT EXISTS), so a re-run is safe.
 *
 * Run:  node scripts/apply-migration-0018.mjs
 * DATABASE_URL comes from the environment or from .env.local / .env in the project root.
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
      /* the file may not exist */
    }
  }
}

const MIGRATION = new URL('../lib/db/migrations/0018_push_campaigns.sql', import.meta.url);

async function main() {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set (.env.local or the environment).');
    process.exit(1);
  }
  console.log('Target host:', new URL(url).hostname);

  const text = readFileSync(MIGRATION, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const statements = text
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  const sql = postgres(url, { max: 1, prepare: false });
  try {
    await sql.begin(async (tx) => {
      for (const stmt of statements) {
        await tx.unsafe(stmt);
        console.log('OK:', stmt.split('\n')[0]);
      }
    });

    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'push_devices' AND column_name IN ('promo_opt_in', 'locale', 'app_version')`;
    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('push_campaigns', 'push_tickets')`;
    console.log('\npush_devices columns:', cols.map((c) => c.column_name).sort().join(', '));
    console.log('tables:', tables.map((t) => t.table_name).sort().join(', '));
    if (cols.length === 3 && tables.length === 2) {
      console.log('\n✅ Migration 0018 applied.');
    } else {
      console.error('\n⚠️ Expected 3 columns and 2 tables.');
      process.exit(1);
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error('Migration failed:', e?.message || e);
  process.exit(1);
});
