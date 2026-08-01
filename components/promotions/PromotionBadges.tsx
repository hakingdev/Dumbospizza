"use client";

import { useEffect } from 'react';
import { trackPromotionEvent } from '../../lib/api-client';
import { computePromoDisplayPrice } from '../../lib/promotions/pricing';
import { useProductBadges } from './PromotionBadgesContext';

/**
 * Просмотр акции засчитываем ОДИН раз на акцию за загрузку страницы. Раньше
 * каждая из ~90 карточек каталога слала свой POST /api/promotions/analytics —
 * это ~90 UPDATE'ов в promotions на один вход в категорию, при том что счётчик
 * всё равно рос от карточек, которых никто не долистал.
 */
const trackedViews = new Set<string>();

function trackViewOnce(promotionId: string) {
  if (!promotionId || trackedViews.has(promotionId)) return;
  trackedViews.add(promotionId);
  trackPromotionEvent(promotionId, 'view').catch(() => {});
}

export function PromotionBadges({
  productId,
  categoryId,
  className = '',
}: {
  productId: string;
  categoryId?: string;
  className?: string;
}) {
  const { badges } = useProductBadges(productId, categoryId);

  useEffect(() => {
    badges.forEach((b) => trackViewOnce(b.promotionId));
  }, [badges]);

  if (badges.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {badges.slice(0, 2).map((b) => (
        <span
          key={b.promotionId}
          title={b.name}
          className="bg-primary-600 text-white text-xs font-bold px-2 py-0.5 rounded"
        >
          {b.badgeText}
        </span>
      ))}
    </div>
  );
}

export function ProductCardPrice({
  productId,
  categoryId,
  basePrice,
  fromLabel = 'Preis ab',
}: {
  productId: string;
  categoryId?: string;
  basePrice: number;
  fromLabel?: string;
}) {
  const { badges, loaded } = useProductBadges(productId, categoryId);

  const { promoPrice, bestPercent, bogoHint } = computePromoDisplayPrice(basePrice, badges);

  if (!loaded) {
    return (
      <span className="shrink-0 whitespace-nowrap text-right text-xl font-bold leading-tight text-primary-600">
        {fromLabel} <span translate="no">{basePrice.toFixed(2)} €</span>
      </span>
    );
  }

  if (promoPrice != null && promoPrice < basePrice) {
    return (
      <div className="shrink-0 max-w-[45%] text-right leading-tight">
        <span className="block text-sm text-gray-400 line-through" translate="no">{basePrice.toFixed(2)} €</span>
        <span className="whitespace-nowrap text-xl font-bold text-primary-600">
          {fromLabel} <span translate="no">{promoPrice.toFixed(2)} €</span>
        </span>
        {bestPercent != null && (
          <span className="block break-words text-xs text-green-700">Heute {bestPercent} % Rabatt</span>
        )}
      </div>
    );
  }

  if (bogoHint) {
    return (
      <div className="shrink-0 max-w-[45%] text-right leading-tight">
        <span className="whitespace-nowrap text-xl font-bold text-primary-600">
          {fromLabel} <span translate="no">{basePrice.toFixed(2)} €</span>
        </span>
        <span className="block break-words text-xs text-green-700">{bogoHint}</span>
      </div>
    );
  }

  return (
    <span className="shrink-0 whitespace-nowrap text-right text-xl font-bold leading-tight text-primary-600">
      {fromLabel} <span translate="no">{basePrice.toFixed(2)} €</span>
    </span>
  );
}

export function ProductPromotionsBanner({
  productId,
  categoryId,
}: {
  productId: string;
  categoryId?: string;
}) {
  const { badges } = useProductBadges(productId, categoryId);

  // Баннер живёт на карточке товара/в модалке — он один на страницу, поэтому
  // просмотр здесь засчитываем как раньше, без общей дедупликации каталога.
  useEffect(() => {
    badges.forEach((b) => {
      trackPromotionEvent(b.promotionId, 'view').catch(() => {});
    });
  }, [badges]);

  if (badges.length === 0) return null;

  return (
    <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg space-y-2">
      {badges.map((b) => (
        <div key={b.promotionId} className="text-sm">
          <span className="font-bold text-green-800">{b.badgeText}</span>
          <span className="text-green-700 ml-2">{b.name}</span>
          {b.scheduleLabel && (
            <span className="block text-amber-700 mt-0.5">
              Happy Hour: {b.scheduleLabel}
              {b.happyHourActive === false && ' (jetzt inaktiv)'}
            </span>
          )}
          {b.type === 'percent_discount' && b.percentValue != null && (
            <span className="block text-green-600 mt-0.5">Heute {b.percentValue} % Rabatt</span>
          )}
          {b.validTo && (
            <span className="block text-xs text-green-600/80 mt-0.5">
              Gültig bis {new Date(b.validTo).toLocaleDateString('de-DE')}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
