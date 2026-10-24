/**
 * Mindermengenzuschlag — доплата до минимальной суммы заказа зоны доставки.
 *
 * Гость, которому не хватает пары евро до Mindestbestellwert, может не
 * добирать товар, а доплатить разницу. Доплата — отдельная позиция заказа
 * (не скрытая надбавка к Liefergebühr): так она без доработок попадает в чек,
 * Telegram, POS, счёт-PDF, VAT-разбивку и PayPal/SumUp-breakdown, которые
 * строятся из позиций заказа.
 *
 * Сумму считает СЕРВЕР по зоне из БД; клиент присылает только согласие.
 * База — товары до скидок (как и проверка min-order на checkout): скидки и
 * баллы на доплату не влияют и к ней не применяются.
 */

import { FOOD_VAT_RATE } from './tax';

export const MIN_ORDER_SURCHARGE_KIND = 'min_order_surcharge' as const;
export const MIN_ORDER_SURCHARGE_NAME = 'Mindermengenzuschlag';

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Сколько не хватает до минимума зоны (0 — минимума нет или он достигнут). */
export function computeMinOrderSurcharge(
  merchandiseSubtotal: number,
  minOrderAmount: number | null | undefined
): number {
  const min = Number(minOrderAmount) || 0;
  const subtotal = Number(merchandiseSubtotal) || 0;
  if (min <= 0 || subtotal >= min) return 0;
  return round2(min - Math.max(subtotal, 0));
}

/** Позиция заказа с доплатой (формат строки orders.items). */
export function buildMinOrderSurchargeItem(amount: number) {
  return {
    product: '',
    kind: MIN_ORDER_SURCHARGE_KIND,
    name: MIN_ORDER_SURCHARGE_NAME,
    quantity: 1,
    price: amount,
    totalPrice: amount,
    // Nebenleistung zur Speisenlieferung → ставка основной поставки (еда, 7 %).
    taxRate: FOOD_VAT_RATE,
  };
}

/**
 * Служебная строка доплаты? Такие строки не товар: их не повторяют
 * («Erneut bestellen») и не считают в «Избранном»/статистике товаров.
 */
export function isMinOrderSurchargeItem(item: { kind?: unknown; name?: unknown; product?: unknown }): boolean {
  if (item?.kind === MIN_ORDER_SURCHARGE_KIND) return true;
  return !item?.product && String(item?.name ?? '').trim() === MIN_ORDER_SURCHARGE_NAME;
}
