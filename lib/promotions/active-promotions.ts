import { Promotion } from '../models/promotion.model';
import { createTtlCache } from '../cache/ttl-cache';

/**
 * Список включённых акций читается на каждый бейдж карточки и на каждый расчёт
 * корзины. Таблица маленькая и меняется руками из админки — держим её в памяти
 * инстанса на TTL и сбрасываем из мутаций акций.
 */
const TTL_MS = 60_000;

const cache = createTtlCache(
  async () => (await Promotion.find({ enabled: true }).lean()) as any[],
  TTL_MS
);

/** Включённые акции (кэш на 60 с внутри инстанса). Объекты НЕ мутировать. */
export function getEnabledPromotions(): Promise<any[]> {
  return cache.get();
}

/** Вызывать из любой мутации акций, иначе админ увидит правку только через TTL. */
export function invalidateEnabledPromotions(): void {
  cache.invalidate();
}
