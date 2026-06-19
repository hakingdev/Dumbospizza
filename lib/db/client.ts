/**
 * Подключение к Postgres (Supabase) через postgres-js + Drizzle.
 *
 * Строка подключения: DATABASE_URL (Supabase → Settings → Database → Connection string,
 * режим Session/Pooler, с паролем БД). Соединение кэшируется на глобальном объекте,
 * чтобы в dev/HMR и в serverless не плодить пулы (как раньше делал connectToDatabase для Mongo).
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const DATABASE_URL = process.env.DATABASE_URL;

declare global {
  // eslint-disable-next-line no-var
  var __pgClient: ReturnType<typeof postgres> | undefined;
  // eslint-disable-next-line no-var
  var __drizzleDb: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

function createClient() {
  if (!DATABASE_URL) {
    throw new Error(
      'DATABASE_URL не задан. Укажи строку подключения Supabase (Session pooler) в .env'
    );
  }
  // prepare:false — совместимость с транзакционным пулером Supabase (PgBouncer).
  return postgres(DATABASE_URL, { prepare: false });
}

const client = global.__pgClient ?? createClient();
export const db = global.__drizzleDb ?? drizzle(client, { schema });

if (process.env.NODE_ENV !== 'production') {
  global.__pgClient = client;
  global.__drizzleDb = db;
}

export { schema };
export default db;
