/**
 * Единый расчёт Lieferkosten. Раньше порог бесплатной доставки был захардкожен
 * (30 €) в четырёх местах — CartContext, checkout, /api/orders — и полностью
 * съедал тариф зоны: у зон от 8 км Mindestbestellwert 32–42 €, то есть любой
 * заказ, который вообще проходит гейт по минималке, уже ≥ 30 € → «Kostenlos».
 * Настроенные в админке 4–6 € не могли примениться в принципе.
 *
 * Теперь порог — настройка (storeSettings.freeDeliveryThreshold), по умолчанию
 * ВЫКЛЮЧЕН (0): действует тариф зоны.
 */

export interface DeliveryFeeInput {
  deliveryType: 'delivery' | 'pickup';
  /** Товарная сумма (subtotal + BOGO-награды), без доставки и скидок. */
  merchandiseSubtotal: number;
  /** Lieferkosten найденной зоны. */
  zoneDeliveryFee: number;
  /** Порог бесплатной доставки; 0/null/undefined — правило выключено. */
  freeDeliveryThreshold?: number | null;
}

/** Порог из настроек: пусто/мусор/отрицательное → 0 (правило выключено). */
export function normalizeFreeDeliveryThreshold(raw: unknown): number {
  const n = typeof raw === 'string' ? parseFloat(raw.replace(',', '.')) : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

/** Итоговые Lieferkosten заказа. */
export function resolveDeliveryFee(input: DeliveryFeeInput): number {
  if (input.deliveryType === 'pickup') return 0;

  const threshold = normalizeFreeDeliveryThreshold(input.freeDeliveryThreshold);
  if (threshold > 0 && input.merchandiseSubtotal >= threshold) return 0;

  const fee = Number(input.zoneDeliveryFee);
  return Number.isFinite(fee) && fee > 0 ? fee : 0;
}
