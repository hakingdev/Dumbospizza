"use client";

import type { PromotionCalculationResult } from '../../lib/promotions/types';
import { getVisibleBogoSecondItems } from '../../lib/promotions/discount-total';
import { resolveDisplayedFreeGifts } from './PromotionCartSummary';

/**
 * Награды акций как строки В СПИСКЕ корзины (рядом с обычными позициями, не внизу):
 *  - BOGO 2-й товар со скидкой/бесплатно,
 *  - Gratis-Artikel (подарок) — 0.00 €.
 * Цена скидочная, рядом перечёркнута исходная (для BOGO half_price).
 */
export default function PromoRewardLines({
  calculation,
  selectedFreeGifts = {},
  variant = 'card',
}: {
  calculation: PromotionCalculationResult | null;
  selectedFreeGifts?: Record<string, string>;
  variant?: 'card' | 'compact';
}) {
  if (!calculation) return null;
  const bogoItems = getVisibleBogoSecondItems(calculation);
  const gifts = resolveDisplayedFreeGifts(calculation, selectedFreeGifts);
  if (bogoItems.length === 0 && gifts.length === 0) return null;

  type Row = {
    key: string;
    name: string;
    badge: string;
    price: number;
    original?: number;
    free: boolean;
  };

  const rows: Row[] = [
    ...bogoItems.map((item) => ({
      key: `b-${item.id || item.productId}-${item.promotionId}`,
      name: item.name,
      badge: item.bogoMode === 'free' ? 'Gratis' : '2. Artikel −50%',
      price: item.unitPrice,
      original: item.originalUnitPrice,
      free: item.bogoMode === 'free',
    })),
    ...gifts.map((g) => ({
      key: `g-${g.productId}-${g.promotionId}`,
      name: g.name,
      badge: 'Gratis-Artikel',
      price: 0,
      free: true,
    })),
  ];

  if (variant === 'compact') {
    return (
      <>
        {rows.map((r) => (
          <div
            key={r.key}
            className={`flex items-center justify-between rounded-lg p-3 border ${
              r.free ? 'bg-emerald-50 border-emerald-200' : 'bg-orange-50 border-orange-200'
            }`}
          >
            <div className="min-w-0">
              <div className="font-medium truncate">
                {r.name}
                <span
                  className={`ml-2 text-xs font-semibold uppercase ${
                    r.free ? 'text-emerald-600' : 'text-orange-600'
                  }`}
                >
                  {r.badge}
                </span>
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <span className={`font-bold ${r.free ? 'text-emerald-700' : 'text-orange-700'}`}>
                {r.price.toFixed(2)} €
              </span>
              {r.original && r.original > r.price && (
                <span className="block text-xs text-gray-400 line-through">
                  {r.original.toFixed(2)} €
                </span>
              )}
            </div>
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      {rows.map((r) => (
        <div
          key={r.key}
          className={`rounded-xl p-4 border ${
            r.free ? 'bg-emerald-50 border-emerald-200' : 'bg-orange-50 border-orange-200'
          }`}
        >
          <div className="flex items-start gap-4">
            <div
              className={`w-20 h-20 rounded-lg flex-shrink-0 flex items-center justify-center text-2xl ${
                r.free ? 'bg-emerald-100' : 'bg-orange-100'
              }`}
            >
              {r.free ? '🎁' : '🍕'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{r.name}</div>
              <span
                className={`inline-block mt-1 text-xs font-semibold uppercase ${
                  r.free ? 'text-emerald-600' : 'text-orange-600'
                }`}
              >
                {r.badge}
              </span>
              <div className="mt-2 text-right">
                <span className={`font-bold ${r.free ? 'text-emerald-700' : 'text-orange-700'}`}>
                  {r.price.toFixed(2)} €
                </span>
                {r.original && r.original > r.price && (
                  <span className="ml-2 text-sm text-gray-400 line-through">
                    {r.original.toFixed(2)} €
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
