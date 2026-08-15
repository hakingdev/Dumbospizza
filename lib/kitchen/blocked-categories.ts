/**
 * Категории остановленных цехов — серверная сторона стопа (стоп-бот).
 *
 * Нужна в двух ролях:
 *   - витрине (GET /api/kitchen/blocks отдаёт categoryId → цех);
 *   - каталогам акций (bogo/gift): подарок из остановленного цеха предлагать
 *     нельзя, иначе гость выберет Gratis-ролл, когда суши не готовят.
 *
 * Читается на каждый расчёт корзины, поэтому кэш на 20 секунд: стоп меняют
 * раз в час, а расчёт акций дёргают на каждое изменение корзины.
 */
import { getSetting } from '../settings';
import { getCategories } from '../db/utils';
import { createTtlCache } from '../cache/ttl-cache';
import {
  activeWorkshopBlocks,
  classifyWorkshop,
  readWorkshopBlocks,
  type WorkshopId,
} from './workshops';

export interface BlockedCategories {
  /** Остановленные цеха ([] — работает всё). */
  workshops: WorkshopId[];
  /** categoryId → цех, который его остановил. */
  byCategoryId: Record<string, WorkshopId>;
  /** До какого времени стоит каждый цех (ISO; '' — работает). */
  blocks: Record<WorkshopId, string>;
}

const EMPTY: BlockedCategories = {
  workshops: [],
  byCategoryId: {},
  blocks: { pizza: '', sushi: '' },
};

async function load(): Promise<BlockedCategories> {
  const settings = (await getSetting<Record<string, any>>('storeSettings', {})) || {};
  const blocks = readWorkshopBlocks(settings);
  const workshops = activeWorkshopBlocks(blocks, new Date());
  if (workshops.length === 0) return { ...EMPTY, blocks };

  const stopped = new Set<WorkshopId>(workshops);
  const byCategoryId: Record<string, WorkshopId> = {};
  for (const category of (await getCategories({})) as any[]) {
    const workshop = classifyWorkshop({ category: category?.name });
    if (workshop && stopped.has(workshop)) byCategoryId[String(category._id)] = workshop;
  }
  return { workshops, byCategoryId, blocks };
}

const cache = createTtlCache(load, 20_000);

export function getBlockedCategories(): Promise<BlockedCategories> {
  return cache.get();
}

/** Сбросить кэш (стоп только что изменили). */
export function invalidateBlockedCategories(): void {
  cache.invalidate();
}

/** Товар (с populated/строковой категорией) из остановленного цеха? */
export function isProductBlocked(
  product: { category?: unknown; name?: unknown },
  blocked: BlockedCategories
): boolean {
  if (blocked.workshops.length === 0) return false;
  const raw: any = product?.category;
  const categoryId = raw && typeof raw === 'object' ? raw._id ?? raw.id : raw;
  return !!categoryId && !!blocked.byCategoryId[String(categoryId)];
}
