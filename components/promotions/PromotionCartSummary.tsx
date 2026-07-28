"use client";

import { Gift } from 'lucide-react';
import type {
  PromotionCalculationResult,
  PromotionFreeGift,
} from '../../lib/promotions/types';
import {
  getAppliedPromotionDiscount,
  getVisibleBogoSecondItems,
} from '../../lib/promotions/discount-total';
import { NoTranslate } from '../NoTranslate';

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
  onPickGift,
  t = (k: string, fb?: string) => fb || k,
}: {
  calculation: PromotionCalculationResult | null;
  selectedFreeGifts?: Record<string, string>;
  declinedFreeGifts?: Record<string, boolean>;
  /**
   * Открыть выбор подарка. Передаётся страницами, у которых есть модалка
   * (GratisGiftPickerModal): строка «Gratis-Artikel» становится кнопкой, и
   * подарок можно выбрать ЗАНОВО — в том числе после «Nein, danke» или после
   * того, как выбор слетел при пересчёте. Без обработчика — просто текст.
   */
  onPickGift?: () => void;
  t?: (key: string, fallback?: string) => string;
}) {
  if (!calculation) return null;

  // BOGO 2-й товар И Gratis-Artikel теперь показываются отдельными строками
  // В СПИСКЕ корзины (PromoRewardLines), а не здесь.
  const rabattTotal = getAppliedPromotionDiscount(calculation);
  const offers = calculation.freeGiftOffers || [];
  const pendingOffers = offers.filter(
    (offer) => !selectedFreeGifts[offer.promotionId] && !declinedFreeGifts[offer.promotionId]
  );
  // Отклонённый подарок: раньше он просто исчезал без следа, и вернуть его на
  // /checkout было нечем (корзину там уже не менять). Показываем кнопку возврата.
  const restorableOffers = onPickGift
    ? offers.filter(
        (offer) => !selectedFreeGifts[offer.promotionId] && declinedFreeGifts[offer.promotionId]
      )
    : [];

  if (rabattTotal <= 0 && pendingOffers.length === 0 && restorableOffers.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 mb-4">
      {calculation.lineAdjustments.map((line, i) => (
        <div key={`${line.productId}-${i}`} className="text-sm text-green-700 flex justify-between">
          <span>
            <NoTranslate>{line.name}</NoTranslate>: {line.label}
          </span>
          <NoTranslate>-{line.discountAmount.toFixed(2)} €</NoTranslate>
        </div>
      ))}
      {calculation.orderDiscountTotal > 0 && (
        <div className="text-sm text-green-700 flex justify-between">
          <span>{t('cart.promo_order_discount', 'Aktion auf Bestellung')}</span>
          <NoTranslate>-{calculation.orderDiscountTotal.toFixed(2)} €</NoTranslate>
        </div>
      )}
      {pendingOffers.map((offer) =>
        onPickGift ? (
          <button
            key={offer.promotionId}
            type="button"
            onClick={onPickGift}
            className="flex min-h-[48px] w-full items-center gap-2 rounded-lg border-2 border-emerald-400 bg-emerald-50 p-3 text-left text-sm font-medium leading-tight text-emerald-800 transition-colors hover:bg-emerald-100"
          >
            <Gift className="h-5 w-5 shrink-0" />
            {t('cart.gratis_pending', 'Gratis-Artikel — bitte auswählen')}
          </button>
        ) : (
          <div key={offer.promotionId} className="text-sm text-amber-700 italic">
            {t('cart.gratis_pending', 'Gratis-Artikel — bitte auswählen')}
          </div>
        )
      )}
      {restorableOffers.map((offer) => (
        <button
          key={`declined-${offer.promotionId}`}
          type="button"
          onClick={onPickGift}
          className="flex min-h-[48px] w-full items-center gap-2 rounded-lg border border-dashed border-emerald-300 bg-white p-3 text-left text-sm font-medium leading-tight text-emerald-700 transition-colors hover:bg-emerald-50"
        >
          <Gift className="h-5 w-5 shrink-0" />
          {t('cart.gratis_repick', 'Gratis-Artikel doch auswählen')}
        </button>
      ))}
      {rabattTotal > 0 && (
        <div className="flex justify-between text-green-600 font-medium border-t pt-2">
          <span>{t('cart.promo_total', 'Rabatt Aktionen')}</span>
          <NoTranslate>-{rabattTotal.toFixed(2)} €</NoTranslate>
        </div>
      )}
    </div>
  );
}

export { resolveDisplayedFreeGifts };
