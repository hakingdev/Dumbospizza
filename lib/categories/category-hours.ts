/**
 * Окна категорий по графику — серверная сторона (правило в ./availability).
 *
 * Читается на каждый опрос витрины (/api/kitchen/blocks раз в минуту), расчёт
 * акций и заказ, поэтому кэш на 20 секунд — как у стопа цехов: граница окна
 * («17:00») сдвигается не больше чем на эти секунды.
 */
import { getSetting } from '../settings';
import { getCategories } from '../db/utils';
import { createTtlCache } from '../cache/ttl-cache';
import { buildCategoryHours, scheduleClosureFor, type CategoryHours, type CategoryWindow } from './availability';

async function load(): Promise<CategoryHours> {
  const [settings, categories] = await Promise.all([
    getSetting<Record<string, any>>('storeSettings', {}),
    getCategories({}),
  ]);
  return buildCategoryHours(categories as any[], settings || {}, new Date());
}

const cache = createTtlCache(load, 20_000);

export function getCategoryHours(): Promise<CategoryHours> {
  return cache.get();
}

/** Сбросить кэш (категорию или её график только что сохранили). */
export function invalidateCategoryHours(): void {
  cache.invalidate();
}

/** Закрытое окно товара (category — id или populated-объект). */
export function productScheduleClosure(
  product: { category?: unknown; subcategoryId?: unknown },
  hours: CategoryHours
): CategoryWindow | null {
  const raw: any = product?.category;
  const categoryId = raw && typeof raw === 'object' ? raw._id ?? raw.id : raw;
  return scheduleClosureFor(
    {
      categoryId: categoryId ? String(categoryId) : null,
      subcategoryId: product?.subcategoryId ? String(product.subcategoryId) : null,
    },
    hours
  );
}
