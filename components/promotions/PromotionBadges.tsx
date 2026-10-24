"use client";

import { useEffect } from 'react';
import { trackPromotionEvent } from '../../lib/api-client';
import { computePromoDisplayPrice } from '../../lib/promotions/pricing';
import { useProductBadges } from './PromotionBadgesContext';
import { formatEuro } from '../../lib/format-euro';
import { formatPromoDate } from '../../lib/format-date';

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
  compact = false,
}: {
  productId: string;
  categoryId?: string;
  className?: string;
  /** Одна строка с обрезкой — для узкой колонки (строчная карточка на телефоне). */
  compact?: boolean;
}) {
  const { badges } = useProductBadges(productId, categoryId);

  useEffect(() => {
    badges.forEach((b) => trackViewOnce(b.promotionId));
  }, [badges]);

  if (badges.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {badges.slice(0, compact ? 1 : 2).map((b) => (
        <span
          key={b.promotionId}
          title={b.name}
          className={`bg-primary-600 text-white text-xs font-bold px-2 py-1 rounded ${compact ? 'max-w-full truncate' : ''}`}
        >
          {b.badgeText}
        </span>
      ))}
    </div>
  );
}

/**
 * Цена карточки товара — своей строкой над кнопкой, а не рядом с названием:
 * в одной flex-строке nowrap-цена text-xl отжимала заголовок до столбика букв
 * на 1024–1200 px. Сумма не переносится, подпись «ab» — может.
 */
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
  const hasPromoPrice = loaded && promoPrice != null && promoPrice < basePrice;
  const shownPrice = hasPromoPrice ? (promoPrice as number) : basePrice;
  const hint = !loaded
    ? null
    : hasPromoPrice && bestPercent != null
      ? `Heute ${bestPercent} % Rabatt`
      : !hasPromoPrice
        ? bogoHint
        : null;

  return (
    <div className="min-w-0 leading-tight">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-base font-bold text-primary-700 md:text-lg">
          {fromLabel}{' '}
          <span className="whitespace-nowrap tabular-nums" translate="no">{formatEuro(shownPrice)}</span>
        </span>
        {hasPromoPrice && (
          <span className="whitespace-nowrap text-sm tabular-nums text-gray-500 line-through" translate="no">
            {formatEuro(basePrice)}
          </span>
        )}
      </p>
      {hint && <p className="mt-0.5 text-xs text-green-700">{hint}</p>}
    </div>
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
              Gültig bis {formatPromoDate(b.validTo)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
