import type { PromotionCalculationResult } from './types';

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Discount subtracted from the order total.
 * In-cart BOGO (2+ units) → productDiscountTotal.
 * Picker BOGO (exactly 1 unit) → savings are already in the reduced picker line price — not subtracted again.
 */
export function getAppliedPromotionDiscount(
  calculation: PromotionCalculationResult | null | undefined
): number {
  if (!calculation) return 0;

  return roundMoney(
    (calculation.productDiscountTotal || 0) + (calculation.orderDiscountTotal || 0)
  );
}

/**
 * Extra picker lines (2. Artikel 50 % / gratis) — only when discount is not already applied on cart lines.
 */
export function getVisibleBogoSecondItems(
  calculation: PromotionCalculationResult | null | undefined
) {
  if (!calculation?.bogoSecondItems?.length) return [];
  // BOGO теперь только через попап (без авто-скидки в строках), поэтому
  // награду показываем всегда, независимо от productDiscountTotal других акций.
  return calculation.bogoSecondItems;
}

export function getBogoPickerMerchandise(
  calculation: PromotionCalculationResult | null | undefined
): number {
  return roundMoney(
    getVisibleBogoSecondItems(calculation).reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0
    )
  );
}
