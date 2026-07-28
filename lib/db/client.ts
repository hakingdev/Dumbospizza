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

/**
 * Размер пула НА ОДИН инстанс функции. Кэш на globalThis спасает от повторных
 * пулов внутри инстанса, но инстансов у Vercel при всплеске трафика десятки, и
 * пул у каждого свой. Дефолты postgres-js (max: 10, idle_timeout: null) означают,
 * что каждая прогретая лямбда бессрочно удерживает до 10 клиентских сокетов
 * Supavisor. Открытая карточка меню = ~94 карточки товара × запрос бейджей акции,
 * то есть сотни параллельных вызовов; на этом упирались в лимит пулера, и запросы
 * падали разом во ВСЕХ роутах («Failed query: select ...»), пока инстансы не
 * остынут (инцидент 28.07.2026, /api/orders + /api/promotions/analytics).
 * max_lifetime не задаём: дефолт (30–60 мин со случайным разбросом) уже разводит
 * переподключения по времени.
 */
const POOL_MAX = parseInt(process.env.DB_POOL_MAX || '', 10) || 3;
/** Отпускать простаивающий сокет, а не держать его до смерти инстанса. */
const IDLE_TIMEOUT_SECONDS = 20;
/** Дефолтные 30 с — дольше, чем живёт сам запрос: лучше упасть быстро. */
const CONNECT_TIMEOUT_SECONDS = 10;

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
    global.__pgClient = postgres(DATABASE_URL, {
      prepare: false,
      max: POOL_MAX,
      idle_timeout: IDLE_TIMEOUT_SECONDS,
      connect_timeout: CONNECT_TIMEOUT_SECONDS,
    });
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
