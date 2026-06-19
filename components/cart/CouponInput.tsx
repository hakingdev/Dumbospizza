import { useState, useEffect } from 'react';
import { useLanguage } from '../../lib/contexts/LanguageContext';
import { loadTranslation } from '../../lib/i18n';
import { validateCoupon, validatePromotionCode } from '../../lib/api-client';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

interface CouponInputProps {
  orderAmount: number;
  onCouponApplied: (couponData: any) => void;
  onCouponRemoved: () => void;
  onPromotionCodeApplied?: (code: string) => void;
  onPromotionCodeRemoved?: () => void;
}

export default function CouponInput({
  orderAmount,
  onCouponApplied,
  onCouponRemoved,
  onPromotionCodeApplied,
  onPromotionCodeRemoved,
}: CouponInputProps) {
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string) => k);
  const [couponCode, setCouponCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedCoupon, setAppliedCoupon] = useState<any>(null);
  const [appliedPromotionCode, setAppliedPromotionCode] = useState<string | null>(null);

  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    };
    loadTranslations();
  }, [language]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponCode) return;

    try {
      setError(null);
      setIsSubmitting(true);

      try {
        const result = await validateCoupon(couponCode, orderAmount);
        if (result.success) {
          setAppliedCoupon(result.coupon);
          setAppliedPromotionCode(null);
          onCouponApplied(result.coupon);
          return;
        }
      } catch (_) {
        // try promotion code
      }

      const promoResult = await validatePromotionCode(couponCode);
      if (promoResult.success) {
        setAppliedCoupon(null);
        setAppliedPromotionCode(promoResult.promotionCode.code);
        onPromotionCodeApplied?.(promoResult.promotionCode.code);
        return;
      }

      setError(t('errors.invalid_promo'));
    } catch (err: any) {
      let errorMessage = t('errors.invalid_promo');
      if (err.response) {
        const responseError = err.response.data?.error || '';
        if (responseError.includes('Minimum order amount')) {
          errorMessage = t('errors.min_order_not_met');
        } else if (responseError.includes('usage limit')) {
          errorMessage = t('errors.promo_used');
        } else if (responseError.includes('expired')) {
          errorMessage = t('errors.promo_expired');
        }
      }
      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemove = () => {
    setCouponCode('');
    setAppliedCoupon(null);
    setAppliedPromotionCode(null);
    setError(null);
    onCouponRemoved();
    onPromotionCodeRemoved?.();
  };

  const hasApplied = appliedCoupon || appliedPromotionCode;

  return (
    <div className="mt-4">
      <p className="text-sm font-medium text-gray-700 mb-2">{t('checkout.promo_code')}</p>

      {!hasApplied ? (
        <form onSubmit={handleSubmit} className="flex space-x-2">
          <div className="flex-1">
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
            className="bg-primary-600 text-white px-4 py-2 rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 transition-colors text-sm"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : t('checkout.apply_promo')}
          </button>
        </form>
      ) : (
        <div className="flex items-center justify-between p-3 bg-green-50 border border-green-100 rounded-md">
          <div className="flex items-center">
            <CheckCircle className="w-5 h-5 text-green-600 mr-2" />
            <div>
              <p className="font-medium text-sm">{appliedCoupon?.code || appliedPromotionCode}</p>
              <p className="text-xs text-gray-600">
                {appliedPromotionCode
                  ? t('cart.promo_code_active', 'Aktionscode — Rabatt wird automatisch berechnet')
                  : appliedCoupon.discountType === 'fixed'
                    ? `${appliedCoupon.discountValue.toFixed(2)} € ${t('cart.discount')}`
                    : `${appliedCoupon.discountValue}% ${t('cart.discount')}`}
              </p>
            </div>
          </div>
          <button onClick={handleRemove} className="text-gray-500 hover:text-gray-700" title={t('cart.remove')}>
            <XCircle className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
}
