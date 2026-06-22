"use client";

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Trash2, Plus, Minus, ShieldCheck, Gift, Percent } from 'lucide-react'
import { useLanguage } from '../../../lib/contexts/LanguageContext'
import { loadTranslation } from '../../../lib/i18n'
import CouponInput from '../../../components/cart/CouponInput'
import OrderSummaryBreakdown from '../../../components/cart/OrderSummaryBreakdown'
import BogoRewardLines from '../../../components/promotions/BogoRewardLines'
import GratisGiftPickerModal from '../../../components/promotions/GratisGiftPickerModal'
import BogoHalfPricePickerModal from '../../../components/promotions/BogoHalfPricePickerModal'
import { SafeImage } from '../../../components/SafeImage'
import { useCart } from '../../../lib/contexts/CartContext'
import { getConflictingPromotions } from '../../../lib/promotions/coupon-conflict'
import { PROMO_CONFLICT_MESSAGE } from '../../../components/cart/PromoConflictDialog'

export default function CartPage() {
  const router = useRouter();
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string) => k);
  const [showGiftModal, setShowGiftModal] = useState(false);
  const [showBogoModal, setShowBogoModal] = useState(false);
  const [bogoSlot, setBogoSlot] = useState<Record<string, string>>({});
  const [giftSlot, setGiftSlot] = useState<Record<string, string>>({});
  const {
    state,
    totals,
    updateItem,
    removeItem,
    applyCoupon,
    removeCoupon,
    setPromotionPromoCode,
    setSelectedFreeGift,
    setSelectedBogoSecond,
  } = useCart();

  const giftOffers = state.promotionCalculation?.freeGiftOffers || [];
  const bogoOffers = state.promotionCalculation?.bogoSecondOffers || [];
  const needsGiftSelection = giftOffers.some(
    (offer) => !state.selectedFreeGifts[offer.promotionId]
  );
  // оффер присутствует только когда есть незаполненный слот награды (движок так решает)
  const needsBogoSelection = bogoOffers.length > 0;

  // Конфликт «купон vs денежная акция»
  const couponActive = !!state.couponCode;
  const conflictAngebotName =
    getConflictingPromotions(state.promotionCalculation)[0]?.promotionName || undefined;
  // Баннер обратного направления: купон уже активен, но доступна денежная акция.
  const [conflictBannerDismissed, setConflictBannerDismissed] = useState(false);
  useEffect(() => {
    if (!couponActive || !state.moneyPromotionAvailable) setConflictBannerDismissed(false);
  }, [couponActive, state.moneyPromotionAvailable]);
  const showSwitchToAngebotBanner =
    couponActive && state.moneyPromotionAvailable && !conflictBannerDismissed;
  
  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    };
    
    loadTranslations();
  }, [language]);

  useEffect(() => {
    // только подарок авто-открываем (он обязателен); BOGO — по кнопке/попапу на меню
    if (giftOffers.length > 0 && needsGiftSelection) {
      setShowGiftModal(true);
    }
  }, [giftOffers.length, needsGiftSelection]);

  const updateQuantity = (itemId: string, newQuantity: number) => {
    if (newQuantity < 1) return
    updateItem(itemId, { quantity: newQuantity })
  }
  
  const subtotal = totals.subtotal ?? 0;
  const deliveryFee = totals.deliveryFee ?? state.deliveryFee;
  const grandTotal = Math.max(0, totals.total ?? 0);

  const handleProceedToCheckout = () => {
    // Награда BOGO опциональна — не блокируем оформление.
    if (needsGiftSelection) {
      setShowGiftModal(true);
      return;
    }
    router.push('/checkout');
  };

  const handleBogoConfirm = () => {
    // добавляем выбранную награду (по одной за пару) и закрываем
    for (const [pid, oid] of Object.entries(bogoSlot)) {
      if (oid) setSelectedBogoSecond(pid, oid);
    }
    setBogoSlot({});
    setShowBogoModal(false);
  };

  const handleGiftConfirm = () => {
    // применяем выбор подарка из временного слота и закрываем
    const allSelected = giftOffers.every((offer) => Boolean(giftSlot[offer.promotionId]));
    if (!allSelected) return;
    for (const [pid, oid] of Object.entries(giftSlot)) {
      if (oid) setSelectedFreeGift(pid, oid);
    }
    setGiftSlot({});
    setShowGiftModal(false);
  };
  
  return (
    <div className="container mx-auto px-4 py-8">
      <Link href="/menu" className="flex items-center text-primary-600 mb-6">
        <ChevronLeft className="w-5 h-5 mr-1" />
        {t('cart.back_to_menu', 'Вернуться к меню')}
      </Link>
      
      <h1 className="text-3xl font-bold mb-8">{t('cart.title', 'Корзина')}</h1>
      
      {state.items.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-xl text-gray-500 mb-6">{t('cart.empty')}</p>
          <Link href="/menu" className="btn-primary">
            {t('cart.continue_shopping')}
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            {/* Cart Items */}
            <div className="bg-white rounded-lg shadow-md overflow-hidden">
              <ul className="divide-y divide-gray-200">
                {state.items.map((item) => (
                  <li key={item.id} className="p-4">
                    <div className="flex flex-col md:flex-row md:items-center gap-4">
                      <div className="md:w-24 h-24 bg-gray-200 rounded-md flex items-center justify-center text-gray-500 flex-shrink-0 overflow-hidden">
                        {item.image ? (
                          <SafeImage src={item.image} alt={item.name} className="w-full h-full object-cover" />
                        ) : (
                          <>[{t('category.image_placeholder', 'Изображение')} {item.name}]</>
                        )}
                      </div>
                      
                      <div className="flex-1">
                        <div className="flex justify-between">
                          <h3 className="text-lg font-semibold">{item.name}</h3>
                          <button 
                            className="text-gray-400 hover:text-red-500 transition-colors"
                            onClick={() => removeItem(item.id)}
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>

                        {item.size && (
                          <div className="text-gray-600 text-sm mb-2">
                            {t('product.size', 'Размер')}: {item.size.name}{(item.size.label || item.size.size) ? ` (${item.size.label || item.size.size})` : ''}
                          </div>
                        )}

                        {item.options?.length ? (
                          <div className="text-gray-600 text-sm mb-2">
                            {item.options.map(o => o.name).join(', ')}
                          </div>
                        ) : null}

                        {item.extras?.sauces?.length ? (
                          <div className="text-gray-600 text-sm mb-2">
                            {t('cart.sauce_label', 'Соус')}: {item.extras.sauces.map(s => s.name).join(', ')}
                          </div>
                        ) : null}

                        {item.extras?.toppings?.length ? (
                          <div className="text-gray-600 text-sm mb-2">
                            {t('cart.extras_label', 'Дополнительно')}: {item.extras.toppings.map(t => t.name).join(', ')}
                          </div>
                        ) : null}
                        
                        <div className="flex justify-between items-center mt-4">
                          <div className="flex items-center border border-gray-300 rounded-md">
                            <button 
                              className="px-2 py-1 hover:bg-gray-100"
                              onClick={() => updateQuantity(item.id, item.quantity - 1)}
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                            <span className="px-3 py-1">{item.quantity}</span>
                            <button 
                              className="px-2 py-1 hover:bg-gray-100"
                              onClick={() => updateQuantity(item.id, item.quantity + 1)}
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="font-semibold">{(item.price * item.quantity).toFixed(2)} €</div>
                          {state.promotionCalculation?.lineAdjustments
                            .filter((l) => l.productId === (item.productId || item.id))
                            .map((l, idx) => (
                              <div key={idx} className="text-xs text-green-600 text-right">
                                {l.label}: -{l.discountAmount.toFixed(2)} €
                              </div>
                            ))}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              {/* Награды акции — строками рядом с товарами */}
              <div className="p-4 pt-0 space-y-2">
                <BogoRewardLines calculation={state.promotionCalculation} selectedFreeGifts={state.selectedFreeGifts} variant="compact" />
              </div>
            </div>
          </div>

          {/* Order Summary */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-md p-6 sticky top-24">
              <h2 className="text-xl font-bold mb-4">{t('cart.summary_title', 'Сводка заказа')}</h2>
              
              <div className="mb-6">
                <OrderSummaryBreakdown
                  subtotal={subtotal}
                  deliveryFee={deliveryFee}
                  total={grandTotal}
                  couponCode={state.couponCode}
                  couponDiscount={state.couponDiscount}
                  loyaltyPointsDiscount={state.loyaltyPointsDiscount}
                  promotionCalculation={state.promotionCalculation}
                  selectedFreeGifts={state.selectedFreeGifts}
                  t={t}
                />
              </div>
              
              {/* Coupon input */}
              <CouponInput
                orderAmount={subtotal}
                appliedCode={state.couponCode}
                appliedDiscount={state.couponDiscount}
                onCouponApplied={(coupon) => applyCoupon(coupon.code, coupon.discount || 0)}
                onCouponRemoved={() => removeCoupon()}
                onPromotionCodeApplied={(code) => setPromotionPromoCode(code)}
                onPromotionCodeRemoved={() => setPromotionPromoCode(undefined)}
                angebotConflictActive={state.moneyPromotionAvailable}
                angebotName={conflictAngebotName}
              />

              {/* Купон активен, но появилась денежная акция — выбор пользователя */}
              {showSwitchToAngebotBanner && (
                <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
                  <p className="text-amber-800">{PROMO_CONFLICT_MESSAGE}</p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => removeCoupon()}
                      className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Angebot behalten
                    </button>
                    <button
                      type="button"
                      onClick={() => setConflictBannerDismissed(true)}
                      className="flex-1 rounded-md bg-primary-600 px-3 py-2 text-xs font-medium text-white hover:bg-primary-700"
                    >
                      Promo-Code anwenden
                    </button>
                  </div>
                </div>
              )}

              {needsBogoSelection && (
                <button
                  type="button"
                  onClick={() => setShowBogoModal(true)}
                  className="w-full mb-4 flex items-center gap-3 p-3 rounded-lg border-2 border-orange-400 bg-orange-50 text-orange-800 hover:bg-orange-100 transition-colors text-left"
                >
                  <Percent className="h-5 w-5 shrink-0" />
                  <span className="text-sm font-medium">
                    {t('cart.bogo_half_pick', '2. Artikel zum halben Preis — bitte wählen')}
                  </span>
                </button>
              )}

              {needsGiftSelection && (
                <button
                  type="button"
                  onClick={() => setShowGiftModal(true)}
                  className="w-full mb-4 flex items-center gap-3 p-3 rounded-lg border-2 border-emerald-400 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 transition-colors text-left"
                >
                  <Gift className="h-5 w-5 shrink-0" />
                  <span className="text-sm font-medium">
                    {t('cart.gratis_pick', 'Gratis-Geschenk — bitte auswählen')}
                  </span>
                </button>
              )}
              
              <button
                type="button"
                onClick={handleProceedToCheckout}
                className="btn-primary w-full mb-4 flex items-center justify-center"
              >
                {t('cart.proceed_to_checkout')}
              </button>
              
              {/* No registration required message */}
              <div className="flex items-center justify-center text-center text-sm text-gray-600 mb-4 bg-gray-50 p-2 rounded">
                <ShieldCheck className="h-4 w-4 mr-1 text-green-600" />
                {t('cart.no_registration_required', 'Регистрация не требуется')}
              </div>
              
              <div className="text-xs text-gray-500 text-center">
                {t('cart.terms_agreement')} <Link href="/terms" className="text-primary-600 hover:underline">{t('footer.terms')}</Link> {t('common.and', 'и')} <Link href="/datenschutz" className="text-primary-600 hover:underline">{t('footer.privacy')}</Link>.
              </div>
            </div>
          </div>
        </div>
      )}

      {showBogoModal && bogoOffers.length > 0 && (
        <BogoHalfPricePickerModal
          offers={bogoOffers}
          selections={bogoSlot}
          onSelect={(promotionId, optionId) => setBogoSlot((s) => ({ ...s, [promotionId]: optionId }))}
          onConfirm={handleBogoConfirm}
          onClose={() => { setBogoSlot({}); setShowBogoModal(false); }}
          t={t}
        />
      )}

      {showGiftModal && giftOffers.length > 0 && (
        <GratisGiftPickerModal
          offers={giftOffers}
          selections={giftSlot}
          onSelect={(promotionId, optionId) => setGiftSlot((s) => ({ ...s, [promotionId]: optionId }))}
          onConfirm={handleGiftConfirm}
          onClose={() => { setGiftSlot({}); setShowGiftModal(false); }}
          t={t}
        />
      )}
    </div>
  )
}
