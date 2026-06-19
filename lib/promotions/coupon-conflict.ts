import type { PromotionType, PromotionCalculationResult } from './types';

/**
 * Совместимость Angebot (акция) и Coupon / Promo-Code.
 *
 * Правило: пользователь не должен получать две ДЕНЕЖНЫЕ скидки одновременно.
 * «Денежные» виды Angebot конфликтуют с купоном:
 *   - percent_discount  (Rabatt Prozent)
 *   - fixed_discount    (Rabatt Euro)
 *   - bogo              (Zweite Pizza zum halben Preis / gratis)
 * «Gratis-Artikel» (gratis_article) — НЕ денежная скидка (добавляет бесплатный
 * товар, а не уменьшает сумму), поэтому совместим с купоном.
 */
export const MONEY_DISCOUNT_TYPES: readonly PromotionType[] = [
  'percent_discount',
  'fixed_discount',
  'bogo',
];

/** Денежный ли это вид акции (конфликтует с купоном). */
export function isMoneyDiscountType(type: PromotionType | undefined | null): boolean {
  return !!type && MONEY_DISCOUNT_TYPES.includes(type);
}

/**
 * Есть ли в расчёте корзины активная ДЕНЕЖНАЯ акция, реально дающая скидку.
 * Используется для определения конфликта с купоном (в обе стороны).
 */
export function hasActiveMoneyDiscount(
  calculation: PromotionCalculationResult | null | undefined
): boolean {
  if (!calculation) return false;
  return (calculation.appliedPromotions || []).some(
    (p) => isMoneyDiscountType(p.promotionType) && (p.savedAmount || 0) > 0
  );
}

/** Список конфликтующих с купоном акций (для UI/диагностики). */
export function getConflictingPromotions(
  calculation: PromotionCalculationResult | null | undefined
): { promotionId: string; promotionName: string; promotionType: PromotionType }[] {
  if (!calculation) return [];
  return (calculation.appliedPromotions || [])
    .filter((p) => isMoneyDiscountType(p.promotionType) && (p.savedAmount || 0) > 0)
    .map((p) => ({
      promotionId: p.promotionId,
      promotionName: p.promotionName,
      promotionType: p.promotionType,
    }));
}
