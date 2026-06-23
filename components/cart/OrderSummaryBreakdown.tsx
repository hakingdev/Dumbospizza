"use client";

import type { PromotionCalculationResult } from '../../lib/promotions/types';
import PromotionCartSummary from '../promotions/PromotionCartSummary';

/**
 * Единый разбор итоговой суммы (subtotal → скидки → Gesamtsumme) для CartModal,
 * /cart и /checkout. Гарантирует, что total всегда объясним строками скидок:
 * купон, Treuepunkte, акции. (Бесплатные подарки / BOGO-награды показываются
 * отдельными строками в списке товаров через BogoRewardLines.)
 */
export interface OrderSummaryBreakdownProps {
  subtotal: number;
  deliveryFee: number;
  total: number;
  couponCode?: string;
  couponDiscount: number;
  loyaltyPointsDiscount: number;
  promotionCalculation: PromotionCalculationResult | null;
  selectedFreeGifts?: Record<string, string>;
  declinedFreeGifts?: Record<string, boolean>;
  t?: (key: string, fallback?: string) => string;
  className?: string;
  /**
   * Liefergebühr-Zeile anzeigen. Im Warenkorb ausgeblendet (Zone/Gebühr noch
   * unbekannt) — die Liefergebühr kommt erst beim Checkout dazu.
   */
  showDelivery?: boolean;
}

export default function OrderSummaryBreakdown({
  subtotal,
  deliveryFee,
  total,
  couponCode,
  couponDiscount,
  loyaltyPointsDiscount,
  promotionCalculation,
  selectedFreeGifts = {},
  declinedFreeGifts = {},
  t = (k: string, fb?: string) => fb || k,
  className = '',
  showDelivery = true,
}: OrderSummaryBreakdownProps) {
  const eur = (v: number) => `${v.toFixed(2)} €`;

  return (
    <div data-testid="order-summary-breakdown" className={`space-y-2 ${className}`}>
      <div className="flex justify-between text-gray-600">
        <span>{t('cart.subtotal', 'Zwischensumme')}</span>
        <span className="whitespace-nowrap">{eur(subtotal)}</span>
      </div>

      {showDelivery && (
        <div className="flex justify-between text-gray-600">
          <span>{t('cart.delivery_fee', 'Liefergebühr')}</span>
          <span className="whitespace-nowrap">
            {deliveryFee === 0 ? t('cart.free_delivery', 'Kostenlos') : eur(deliveryFee)}
          </span>
        </div>
      )}

      {/* Скидка по промокоду — с явным указанием кода */}
      {couponDiscount > 0 && (
        <div data-testid="coupon-discount-line" className="flex justify-between gap-3 text-green-600">
          <span className="min-w-0">
            {t('cart.coupon_discount_with_code', 'Rabatt mit Gutscheincode')}
            {couponCode ? ` ${couponCode}` : ''}
          </span>
          <span className="whitespace-nowrap">-{eur(couponDiscount)}</span>
        </div>
      )}

      {/* Treuepunkte */}
      {loyaltyPointsDiscount > 0 && (
        <div className="flex justify-between gap-3 text-green-600">
          <span className="min-w-0">{t('cart.loyalty_discount', 'Treuepunkte')}</span>
          <span className="whitespace-nowrap">-{eur(loyaltyPointsDiscount)}</span>
        </div>
      )}

      {/* Автоматические акции (Rabatt/Angebot) */}
      <PromotionCartSummary
        calculation={promotionCalculation}
        selectedFreeGifts={selectedFreeGifts}
        declinedFreeGifts={declinedFreeGifts}
        t={t}
      />

      <div className="border-t pt-2 flex justify-between font-bold text-lg">
        <span>{t('cart.total', 'Gesamtsumme')}</span>
        <span className="text-primary-600 whitespace-nowrap">
          {eur(showDelivery ? total : total - deliveryFee)}
        </span>
      </div>
    </div>
  );
}
