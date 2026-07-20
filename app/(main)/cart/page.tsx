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
import { NoTranslate } from '../../../components/NoTranslate'

export default function CartPage() {
  const router = useRouter();
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string, fallback?: string) => fallback ?? k);
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
    declineFreeGift,
    setSelectedBogoSecond,
  } = useCart();

  const giftOffers = state.promotionCalculation?.freeGiftOffers || [];
  const bogoOffers = state.promotionCalculation?.bogoSecondOffers || [];
  const needsGiftSelection = giftOffers.some(
    (offer) => !state.selectedFreeGifts[offer.promotionId] && !state.declinedFreeGifts[offer.promotionId]
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
    // Gratis-Artikel einmal anbieten; BOGO — по кнопке/попапу на меню.
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
  const couponOrderAmount = state.items.reduce((s, i) => s + i.price * i.quantity, 0);

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

  const openBogoModal = () => {
    // Фиксированная награда (1 позиция от ресторана) — предвыбираем, модалка = подтверждение.
    setBogoSlot((s) => {
      const next = { ...s };
      for (const o of bogoOffers) {
        if (o.options.length === 1 && !next[o.promotionId]) {
          next[o.promotionId] = o.options[0].id || o.options[0].productId;
        }
      }
      return next;
    });
    setShowBogoModal(true);
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
      <Link href="/menu" className="mb-6 inline-flex max-w-full items-center gap-1 leading-tight text-primary-600">
        <ChevronLeft className="h-5 w-5 shrink-0" />
        {t('cart.back_to_menu', 'Zurück zur Speisekarte')}
      </Link>
      
      <h1 className="text-3xl font-bold mb-8">{t('cart.title', 'Warenkorb')}</h1>
      
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
                          <>[{t('category.image_placeholder', 'Bild')} <NoTranslate>{item.name}</NoTranslate>]</>
                        )}
                      </div>

                      <div className="flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="min-w-0 break-words text-lg font-semibold leading-tight">
                            <NoTranslate>{item.name}</NoTranslate>
                          </h3>
                          <button
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                            onClick={() => removeItem(item.id)}
                            aria-label={t('cart.remove_item', 'Entfernen')}
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>

                        {item.size && (
                          <div className="text-gray-600 text-sm mb-2">
                            {t('product.size', 'Größe')}: <NoTranslate>{item.size.name}{(item.size.label || item.size.size) ? ` (${item.size.label || item.size.size})` : ''}</NoTranslate>
                          </div>
                        )}

                        {item.options?.length ? (
                          <div className="text-gray-600 text-sm mb-2">
                            <NoTranslate>{item.options.map(o => o.name).join(', ')}</NoTranslate>
                          </div>
                        ) : null}

                        {item.extras?.sauces?.length ? (
                          <div className="text-gray-600 text-sm mb-2">
                            {t('cart.sauce_label', 'Sauce')}: <NoTranslate>{item.extras.sauces.map(s => s.name).join(', ')}</NoTranslate>
                          </div>
                        ) : null}

                        {item.extras?.toppings?.length ? (
                          <div className="text-gray-600 text-sm mb-2">
                            {t('cart.extras_label', 'Extras')}: <NoTranslate>{item.extras.toppings.map(t => t.name).join(', ')}</NoTranslate>
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
                          <NoTranslate className="font-semibold">{(item.price * item.quantity).toFixed(2)} €</NoTranslate>
                          {state.promotionCalculation?.lineAdjustments
                            .filter((l) => l.productId === (item.productId || item.id))
                            .map((l, idx) => (
                              <div key={idx} className="text-xs text-green-600 text-right">
                                {l.label}: <NoTranslate>-{l.discountAmount.toFixed(2)} €</NoTranslate>
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
              <h2 className="text-xl font-bold mb-4">{t('cart.summary_title', 'Bestellübersicht')}</h2>
              
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
                  declinedFreeGifts={state.declinedFreeGifts}
                  t={t}
                  showDelivery={false}
                />
              </div>
              
              {/* Coupon input */}
              <CouponInput
                orderAmount={couponOrderAmount}
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
                      className="inline-flex min-h-[40px] flex-1 items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-center text-xs font-medium leading-tight text-gray-700 hover:bg-gray-50"
                    >
                      Angebot behalten
                    </button>
                    <button
                      type="button"
                      onClick={() => setConflictBannerDismissed(true)}
                      className="inline-flex min-h-[40px] flex-1 items-center justify-center rounded-md bg-primary-600 px-3 py-2 text-center text-xs font-medium leading-tight text-white hover:bg-primary-700"
                    >
                      Promo-Code anwenden
                    </button>
                  </div>
                </div>
              )}

              {needsBogoSelection && (
                <button
                  type="button"
                  onClick={openBogoModal}
                  className="mb-4 flex min-h-[56px] w-full items-center gap-3 rounded-lg border-2 border-orange-400 bg-orange-50 p-3 text-left leading-tight text-orange-800 transition-colors hover:bg-orange-100"
                >
                  <Percent className="h-5 w-5 shrink-0" />
                  <span className="text-sm font-medium">
                    {bogoOffers[0]?.bogoMode === 'half_price'
                      ? t('cart.bogo_half_pick', '2+1 Aktion: 3. Artikel zum halben Preis — jetzt sichern')
                      : t('cart.bogo_free_pick', '2+1 Aktion: 3. Artikel gratis — jetzt sichern')}
                  </span>
                </button>
              )}

              {needsGiftSelection && (
                <button
                  type="button"
                  onClick={() => setShowGiftModal(true)}
                  className="mb-4 flex min-h-[56px] w-full items-center gap-3 rounded-lg border-2 border-emerald-400 bg-emerald-50 p-3 text-left leading-tight text-emerald-800 transition-colors hover:bg-emerald-100"
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
                {t('cart.no_registration_required', 'Keine Registrierung erforderlich')}
              </div>
              
              <div className="text-xs text-gray-500 text-center">
                {t('cart.terms_agreement')} <Link href="/terms" className="text-primary-600 hover:underline">{t('footer.terms')}</Link> {t('common.and', 'und')} <Link href="/datenschutz" className="text-primary-600 hover:underline">{t('footer.privacy')}</Link>.
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
          onClose={() => {
            giftOffers.forEach((offer) => declineFreeGift(offer.promotionId));
            setGiftSlot({});
            setShowGiftModal(false);
          }}
          t={t}
        />
      )}
    </div>
  )
}
