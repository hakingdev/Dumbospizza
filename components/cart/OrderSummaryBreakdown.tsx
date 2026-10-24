"use client";

import type { PromotionCalculationResult } from '../../lib/promotions/types';
import { getBogoPickerMerchandise } from '../../lib/promotions/discount-total';
import PromotionCartSummary from '../promotions/PromotionCartSummary';
import { NoTranslate } from '../NoTranslate';
import { formatEuro } from '../../lib/format-euro';

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
  const eur = formatEuro;
  const merchandiseSubtotal = subtotal + getBogoPickerMerchandise(promotionCalculation);

  return (
    <div data-testid="order-summary-breakdown" className={`space-y-2 ${className}`}>
      <div className="flex justify-between text-gray-600">
        <span>{t('cart.subtotal', 'Zwischensumme')}</span>
        <NoTranslate className="whitespace-nowrap">{eur(merchandiseSubtotal)}</NoTranslate>
      </div>

      {showDelivery && (
        <div data-testid="delivery-fee-line" className="flex justify-between text-gray-600">
          <span>{t('cart.delivery_fee', 'Liefergebühr')}</span>
          <span className="whitespace-nowrap">
            {deliveryFee === 0 ? t('cart.free_delivery', 'Kostenlos') : <NoTranslate>{eur(deliveryFee)}</NoTranslate>}
          </span>
        </div>
      )}

      {/* Скидка по промокоду — с явным указанием кода */}
      {couponDiscount > 0 && (
        <div data-testid="coupon-discount-line" className="flex justify-between gap-3 text-green-600">
          <span className="min-w-0">
            {t('cart.coupon_discount_with_code', 'Rabatt mit Gutscheincode')}
            {couponCode ? <> <NoTranslate>{couponCode}</NoTranslate></> : ''}
          </span>
          <NoTranslate className="whitespace-nowrap">-{eur(couponDiscount)}</NoTranslate>
        </div>
      )}

      {/* Treuepunkte */}
      {loyaltyPointsDiscount > 0 && (
        <div className="flex justify-between gap-3 text-green-600">
          <span className="min-w-0">{t('cart.loyalty_discount', 'Treuepunkte')}</span>
          <NoTranslate className="whitespace-nowrap">-{eur(loyaltyPointsDiscount)}</NoTranslate>
        </div>
      )}

      {/* Автоматические акции (Rabatt/Angebot) */}
      <PromotionCartSummary
        calculation={promotionCalculation}
        selectedFreeGifts={selectedFreeGifts}
        declinedFreeGifts={declinedFreeGifts}
        t={t}
      />

      {/* Без адреса Liefergebühr ещё неизвестна: «Gesamtsumme» здесь обещала бы
          итог, а в checkout добавлялись +3 €. Честная подпись — «Summe» и пометка. */}
      <div className="border-t pt-2 flex justify-between font-bold text-lg">
        <span>{showDelivery ? t('cart.total', 'Gesamtsumme') : t('cart.total_without_delivery', 'Summe')}</span>
        <NoTranslate className="text-primary-600 whitespace-nowrap">
          {eur(showDelivery ? total : total - deliveryFee)}
        </NoTranslate>
      </div>
      {!showDelivery && (
        <p className="text-right text-xs text-gray-500">
          {t('cart.delivery_fee_hint', 'zzgl. Liefergebühr je nach Liefergebiet')}
        </p>
      )}
    </div>
  );
}
