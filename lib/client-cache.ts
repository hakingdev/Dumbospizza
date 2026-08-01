/**
 * Кэш GET-ответов каталога на стороне браузера.
 *
 * Каталог — client-side страницы: каждый переход «главная → категория → назад»
 * заново дёргал /api/products и /api/categories, хотя данные те же самые.
 * Держим ответ минуту в памяти вкладки: повторный клик по категории рисуется
 * мгновенно, без спиннера и без похода в БД.
 *
 * Дополнительно склеиваем параллельные запросы по одному URL (inflight): если
 * два компонента на странице просят один и тот же список, уходит один запрос.
 */

type Entry = { at: number; data: unknown };

const DEFAULT_TTL_MS = 60_000;

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

/** Сбросить кэш — целиком или по подстроке URL (например 'products'). */
export function invalidateClientCache(urlPart?: string): void {
  if (!urlPart) {
    cache.clear();
    return;
  }
  for (const key of Array.from(cache.keys())) {
    if (key.includes(urlPart)) cache.delete(key);
  }
}

export async function cachedJson<T = any>(url: string, ttlMs = DEFAULT_TTL_MS): Promise<T> {
  // На сервере (SSR клиентских компонентов) кэш общий на все запросы — не рискуем.
  if (typeof window === 'undefined') {
    const response = await fetch(url);
    return (await response.json()) as T;
  }

  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) {
    return hit.data as T;
  }

  const pending = inflight.get(url);
  if (pending) return pending as Promise<T>;

  const request = fetch(url)
    .then((response) => response.json())
    .then((data) => {
      cache.set(url, { at: Date.now(), data });
      return data;
    })
    .finally(() => {
      inflight.delete(url);
    });

  inflight.set(url, request);
  return request as Promise<T>;
}
