import { cachedJson } from '../client-cache';

/**
 * Карточка товара начинает грузить товар уже при касании фото/«+», а модалка
 * берёт тот же запрос (cachedJson склеивает параллельные и держит ответ).
 * 15 с хватает, чтобы данные дожили до открытия модалки, и не дают показать
 * устаревшую цену при повторном открытии через минуту.
 */
export const PRODUCT_CACHE_TTL_MS = 15_000;

export function loadProduct<T = any>(productId: string): Promise<T> {
  return cachedJson<T>(`/api/products/${productId}`, PRODUCT_CACHE_TTL_MS);
}

export function prefetchProduct(productId: string) {
  loadProduct(productId).catch(() => {});
}
