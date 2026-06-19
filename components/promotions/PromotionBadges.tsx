"use client";

import { useEffect, useState } from 'react';
import { trackPromotionEvent } from '../../lib/api-client';
import { computePromoDisplayPrice } from '../../lib/promotions/pricing';

type Badge = {
  promotionId: string;
  badgeText: string;
  name: string;
  type?: string;
  percentValue?: number;
  fixedValue?: number;
  validTo?: string;
  scheduleLabel?: string;
  happyHourActive?: boolean;
};

export function PromotionBadges({
  productId,
  categoryId,
  className = '',
}: {
  productId: string;
  categoryId?: string;
  className?: string;
}) {
  const [badges, setBadges] = useState<Badge[]>([]);

  useEffect(() => {
    if (!productId) return;
    const params = new URLSearchParams();
    if (categoryId) params.set('categoryId', categoryId);
    fetch(`/api/promotions/product/${productId}?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          const list = data.badges || [];
          setBadges(list);
          list.forEach((b: Badge) => {
            trackPromotionEvent(b.promotionId, 'view').catch(() => {});
          });
        }
      })
      .catch(() => {});
  }, [productId, categoryId]);

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
  fromLabel = 'ab',
}: {
  productId: string;
  categoryId?: string;
  basePrice: number;
  fromLabel?: string;
}) {
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!productId) return;
    setLoaded(false);
    const params = new URLSearchParams();
    if (categoryId) params.set('categoryId', categoryId);
    fetch(`/api/promotions/product/${productId}?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setBadges(data.badges || []);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [productId, categoryId]);

  const { promoPrice, bestPercent, bogoHint } = computePromoDisplayPrice(basePrice, badges);

  if (!loaded) {
    return (
      <span className="text-xl font-bold text-primary-600">
        {fromLabel} {basePrice.toFixed(2)} €
      </span>
    );
  }

  if (promoPrice != null && promoPrice < basePrice) {
    return (
      <div className="text-right">
        <span className="text-sm text-gray-400 line-through block">{basePrice.toFixed(2)} €</span>
        <span className="text-xl font-bold text-primary-600">
          {fromLabel} {promoPrice.toFixed(2)} €
        </span>
        {bestPercent != null && (
          <span className="text-xs text-green-700 block">Heute {bestPercent} % Rabatt</span>
        )}
      </div>
    );
  }

  if (bogoHint) {
    return (
      <div className="text-right">
        <span className="text-xl font-bold text-primary-600">
          {fromLabel} {basePrice.toFixed(2)} €
        </span>
        <span className="text-xs text-green-700 block">{bogoHint}</span>
      </div>
    );
  }

  return (
    <span className="text-xl font-bold text-primary-600">
      {fromLabel} {basePrice.toFixed(2)} €
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
  const [badges, setBadges] = useState<Badge[]>([]);

  useEffect(() => {
    if (!productId) return;
    const params = new URLSearchParams();
    if (categoryId) params.set('categoryId', categoryId);
    fetch(`/api/promotions/product/${productId}?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          const list = data.badges || [];
          setBadges(list);
          list.forEach((b: Badge) => {
            trackPromotionEvent(b.promotionId, 'view').catch(() => {});
          });
        }
      })
      .catch(() => {});
  }, [productId, categoryId]);

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
