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

function getClient() {
  if (!global.__pgClient) {
    if (!DATABASE_URL) {
      throw new Error(
        'DATABASE_URL не задан. Укажи строку подключения Supabase (Session pooler) в .env'
      );
    }
    // prepare:false — совместимость с транзакционным пулером Supabase (PgBouncer).
    global.__pgClient = postgres(DATABASE_URL, { prepare: false });
  }
  return global.__pgClient;
}

function getDb() {
  if (!global.__drizzleDb) {
    global.__drizzleDb = drizzle(getClient(), { schema });
  }
  return global.__drizzleDb;
}

/**
 * Ленивый прокси: подключение к БД создаётся при первом реальном обращении к `db`,
 * а не при импорте модуля. Это позволяет Next.js собирать роуты на этапе билда
 * без DATABASE_URL — ошибка возникнет только при фактическом запросе в рантайме.
 */
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop, receiver) {
    const real = getDb();
    const value = Reflect.get(real as object, prop, receiver);
    return typeof value === 'function' ? value.bind(real) : value;
  },
});

export { schema };
export default db;
