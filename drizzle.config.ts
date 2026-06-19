import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Config } from 'drizzle-kit';

/**
 * Конфиг drizzle-kit. `generate` строит SQL-миграции из lib/db/schema.ts офлайн
 * (без подключения к БД). `migrate`/`push` требуют DATABASE_URL (Supabase).
 *
 * drizzle-kit CLI (в отличие от Next.js) не подхватывает .env сам — поэтому
 * читаем DATABASE_URL из .env, если он не задан в окружении.
 */
function dbUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    const line = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
    if (line) return line.slice('DATABASE_URL='.length).trim();
  } catch {
    /* .env может отсутствовать */
  }
  return 'postgres://placeholder';
}

export default {
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: dbUrl(),
  },
  strict: true,
  verbose: true,
} satisfies Config;
