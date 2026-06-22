import { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../../lib/contexts/LanguageContext';
import { loadTranslation } from '../../lib/i18n';
import { validateCoupon, validatePromotionCode } from '../../lib/api-client';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import PromoConflictDialog from './PromoConflictDialog';

interface CouponInputProps {
  orderAmount: number;
  onCouponApplied: (couponData: any) => void;
  onCouponRemoved: () => void;
  onPromotionCodeApplied?: (code: string) => void;
  onPromotionCodeRemoved?: () => void;
  /** Активна денежная акция (Rabatt/BOGO) — купон с ней не комбинируется. */
  angebotConflictActive?: boolean;
  /** Название конфликтующей акции (для диалога). */
  angebotName?: string;
  /** Controlled: применённый код из источника истины (CartContext, после hydration). */
  appliedCode?: string;
  /** Controlled: сумма скидки купона (€) из CartContext. */
  appliedDiscount?: number;
  /** Controlled: тип скидки, если известен. */
  appliedDiscountType?: 'fixed' | 'percentage';
}

export default function CouponInput({
  orderAmount,
  onCouponApplied,
  onCouponRemoved,
  onPromotionCodeApplied,
  onPromotionCodeRemoved,
  angebotConflictActive = false,
  angebotName,
  appliedCode,
  appliedDiscount = 0,
  appliedDiscountType,
}: CouponInputProps) {
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string) => k);
  const [couponCode, setCouponCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedCoupon, setAppliedCoupon] = useState<any>(null);
  const [appliedPromotionCode, setAppliedPromotionCode] = useState<string | null>(null);
  // Купон, прошедший валидацию, но ожидающий решения по конфликту с акцией.
  const [pendingCoupon, setPendingCoupon] = useState<any>(null);
  // Счётчик запросов: ответ от устаревшего submit не должен перезаписывать новый state.
  const reqSeq = useRef(0);

  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    };
    loadTranslations();
  }, [language]);

  // Текст ошибки выбираем по machine-readable reason, а не парсингом строки.
  const couponErrorText = (reason?: string): string => {
    switch (reason) {
      case 'expired':
        return t('errors.promo_expired');
      case 'usage_limit':
        return t('errors.promo_used');
      case 'min_order':
        return t('errors.min_order_not_met');
      default:
        return t('errors.invalid_promo');
    }
  };

  // Купон найден, но точно невалиден → показываем конкретную ошибку и НЕ пробуем промокод.
  const STOP_REASONS = ['expired', 'inactive', 'usage_limit', 'min_order', 'not_started'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = couponCode.trim().toUpperCase();
    if (!code) return;

    const seq = ++reqSeq.current;
    setError(null);
    setIsSubmitting(true);
    try {
      const couponRes = await validateCoupon(code, orderAmount);
      if (seq !== reqSeq.current) return; // устаревший ответ — игнорируем

      if (couponRes.success) {
        // Валидный купон: при конфликте с денежной акцией — диалог выбора,
        // иначе применяем. Никогда не показываем здесь «expired».
        if (angebotConflictActive) {
          setPendingCoupon(couponRes.coupon);
          return;
        }
        setAppliedCoupon(couponRes.coupon);
        setAppliedPromotionCode(null);
        onCouponApplied(couponRes.coupon);
        return;
      }

      if (couponRes.reason && STOP_REASONS.includes(couponRes.reason)) {
        setError(couponErrorText(couponRes.reason));
        return;
      }

      // Купон не найден (not_found / сеть) → пробуем промо-код акции.
      const promoRes = await validatePromotionCode(code);
      if (seq !== reqSeq.current) return; // устаревший ответ

      if (promoRes?.success) {
        setAppliedCoupon(null);
        setAppliedPromotionCode(promoRes.promotionCode.code);
        onPromotionCodeApplied?.(promoRes.promotionCode.code);
        return;
      }

      setError(t('errors.invalid_promo'));
    } catch (_err) {
      if (seq !== reqSeq.current) return;
      setError(t('errors.invalid_promo'));
    } finally {
      if (seq === reqSeq.current) setIsSubmitting(false);
    }
  };

  const handleRemove = () => {
    reqSeq.current++; // инвалидируем любые незавершённые проверки
    setCouponCode('');
    setAppliedCoupon(null);
    setAppliedPromotionCode(null);
    setError(null);
    onCouponRemoved();
    onPromotionCodeRemoved?.();
  };

  // Конфликт: пользователь решил применить промокод вместо акции.
  const handleApplyPendingCoupon = () => {
    const coupon = pendingCoupon;
    setPendingCoupon(null);
    if (!coupon) return;
    setAppliedCoupon(coupon);
    setAppliedPromotionCode(null);
    onCouponApplied(coupon);
  };

  // Конфликт: пользователь решил оставить акцию — купон не применяется.
  const handleKeepAngebot = () => {
    setPendingCoupon(null);
    setCouponCode('');
  };

  // Controlled + local: applied-card показываем, если код есть в источнике истины
  // (appliedCode после hydration из localStorage) ИЛИ применён локально.
  const showApplied = !!(appliedCoupon || appliedPromotionCode || appliedCode);
  const displayCode = appliedCoupon?.code || appliedPromotionCode || appliedCode || '';
  const isPromoCodeOnly = !!appliedPromotionCode && !appliedCoupon;
  const subtitle = isPromoCodeOnly
    ? t('cart.promo_code_active', 'Aktionscode — Rabatt wird automatisch berechnet')
    : appliedCoupon
      ? appliedCoupon.discountType === 'fixed'
        ? `${appliedCoupon.discountValue.toFixed(2)} € ${t('cart.discount', 'Rabatt')}`
        : `${appliedCoupon.discountValue}% ${t('cart.discount', 'Rabatt')}`
      : appliedDiscountType === 'percentage'
        ? `${appliedDiscount}% ${t('cart.discount', 'Rabatt')}`
        : appliedDiscount > 0
          ? `${appliedDiscount.toFixed(2)} € ${t('cart.discount', 'Rabatt')}`
          : '';

  return (
    <div className="mt-4">
      <p className="text-sm font-medium text-gray-700 mb-2">{t('checkout.promo_code')}</p>

      {!showApplied ? (
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="min-w-0 flex-1">
            <input
              type="text"
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
              placeholder={t('checkout.promo_placeholder')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 text-sm"
            />
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          </div>
          <button
            type="submit"
            disabled={!couponCode || isSubmitting}
            className="inline-flex min-h-[40px] shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-primary-600 px-4 py-2 text-center text-sm font-medium leading-tight text-white transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : t('checkout.apply_promo')}
          </button>
        </form>
      ) : (
        <div className="flex flex-col gap-3 p-3 bg-green-50 border border-green-100 rounded-md sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start min-w-0">
            <CheckCircle className="w-5 h-5 text-green-600 mr-2 shrink-0" />
            <div className="min-w-0">
              <p className="font-medium text-sm break-words">{displayCode}</p>
              {subtitle && <p className="text-xs text-gray-600">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={handleRemove}
            aria-label={t('cart.remove_promo', 'Gutscheincode entfernen')}
            title={t('cart.remove_promo', 'Gutscheincode entfernen')}
            className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors shrink-0 w-full sm:w-auto"
          >
            <XCircle className="w-4 h-4" />
            {t('cart.remove_promo_short', 'Entfernen')}
          </button>
        </div>
      )}

      <PromoConflictDialog
        open={!!pendingCoupon}
        angebotName={angebotName}
        promoCode={pendingCoupon?.code}
        onKeepAngebot={handleKeepAngebot}
        onApplyPromoCode={handleApplyPendingCoupon}
      />
    </div>
  );
}
