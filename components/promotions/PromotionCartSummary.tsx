"use client";

import type {
  PromotionCalculationResult,
  PromotionFreeGift,
} from '../../lib/promotions/types';
import {
  getAppliedPromotionDiscount,
  getVisibleBogoSecondItems,
} from '../../lib/promotions/discount-total';

function resolveDisplayedFreeGifts(
  calculation: PromotionCalculationResult,
  selectedFreeGifts: Record<string, string> = {}
): PromotionFreeGift[] {
  const gifts = [...calculation.freeGifts];
  // «Один физический товар максимум раз»: один и тот же продукт (productId) не
  // показываем дважды — ни при гонке пересчёта (offer + freeGift на одну акцию),
  // ни когда две разные gratis-акции дают один товар. Источник истины — productId.
  const seenProducts = new Set(gifts.map((g) => String(g.productId)));
  for (const offer of calculation.freeGiftOffers || []) {
    const selected = selectedFreeGifts[offer.promotionId];
    if (!selected) continue;
    const option = offer.options.find((o) => o.id === selected || o.productId === selected);
    if (!option) continue;
    if (seenProducts.has(String(option.productId))) continue;
    seenProducts.add(String(option.productId));
    gifts.push({
      productId: option.productId,
      sizeName: option.sizeName,
      name: option.name,
      quantity: 1,
      promotionId: offer.promotionId,
      promotionName: offer.promotionName,
      label: offer.label,
    });
  }
  return gifts;
}

export default function PromotionCartSummary({
  calculation,
  selectedFreeGifts = {},
  declinedFreeGifts = {},
  t = (k: string, fb?: string) => fb || k,
}: {
  calculation: PromotionCalculationResult | null;
  selectedFreeGifts?: Record<string, string>;
  declinedFreeGifts?: Record<string, boolean>;
  t?: (key: string, fallback?: string) => string;
}) {
  if (!calculation) return null;

  // BOGO 2-й товар И Gratis-Artikel теперь показываются отдельными строками
  // В СПИСКЕ корзины (PromoRewardLines), а не здесь.
  const rabattTotal = getAppliedPromotionDiscount(calculation);
  const pendingOffers = (calculation.freeGiftOffers || []).filter(
    (offer) => !selectedFreeGifts[offer.promotionId] && !declinedFreeGifts[offer.promotionId]
  );

  if (rabattTotal <= 0 && pendingOffers.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 mb-4">
      {calculation.lineAdjustments.map((line, i) => (
        <div key={`${line.productId}-${i}`} className="text-sm text-green-700 flex justify-between">
          <span>
            {line.name}: {line.label}
          </span>
          <span>-{line.discountAmount.toFixed(2)} €</span>
        </div>
      ))}
      {calculation.orderDiscountTotal > 0 && (
        <div className="text-sm text-green-700 flex justify-between">
          <span>{t('cart.promo_order_discount', 'Aktion auf Bestellung')}</span>
          <span>-{calculation.orderDiscountTotal.toFixed(2)} €</span>
        </div>
      )}
      {pendingOffers.map((offer) => (
        <div key={offer.promotionId} className="text-sm text-amber-700 italic">
          {t('cart.gratis_pending', 'Gratis-Artikel — bitte auswählen')}
        </div>
      ))}
      {rabattTotal > 0 && (
        <div className="flex justify-between text-green-600 font-medium border-t pt-2">
          <span>{t('cart.promo_total', 'Rabatt Aktionen')}</span>
          <span>-{rabattTotal.toFixed(2)} €</span>
        </div>
      )}
    </div>
  );
}

export { resolveDisplayedFreeGifts };
