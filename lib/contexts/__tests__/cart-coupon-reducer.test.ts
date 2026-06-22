import { describe, it, expect } from 'vitest';
import { cartReducer } from '../CartContext';

/**
 * Удаление купона/промокода должно полностью вернуть состояние автоматических
 * Angebote (источник истины — новый расчёт без купона), не теряя без причины
 * выбор подарка / второго товара.
 */
function baseState(over: Record<string, any> = {}): any {
  return {
    items: [],
    subtotal: 0,
    tax: 0,
    deliveryFee: 0,
    total: 0,
    deliveryType: 'delivery',
    deliveryZone: null,
    minOrderAmount: 0,
    loyaltyPointsToRedeem: 0,
    loyaltyPointsDiscount: 0,
    couponDiscount: 0,
    moneyPromotionAvailable: false,
    promotionCalculation: null,
    selectedFreeGifts: {},
    selectedBogoSecond: {},
    contactInfo: { name: '', phoneNumber: '' },
    ...over,
  };
}

function calc(over: Record<string, any> = {}): any {
  return {
    subtotal: 0,
    productDiscountTotal: 0,
    orderDiscountTotal: 0,
    promotionDiscountTotal: 0,
    lineAdjustments: [],
    freeGifts: [],
    freeGiftOffers: [],
    bogoSecondOffers: [],
    bogoSecondItems: [],
    appliedPromotions: [],
    ...over,
  };
}

describe('cartReducer / REMOVE_COUPON', () => {
  it('чистит couponCode, couponDiscount И promotionPromoCode (couponActive станет false)', () => {
    const state = baseState({
      couponCode: 'TEAM',
      couponDiscount: 5,
      promotionPromoCode: 'TEAM',
    });
    const next = cartReducer(state, { type: 'REMOVE_COUPON' });
    expect(next.couponCode).toBeUndefined();
    expect(next.couponDiscount).toBe(0);
    expect(next.promotionPromoCode).toBeUndefined();
  });

  it('НЕ затирает selectedFreeGifts / selectedBogoSecond (выбор пользователя сохраняется)', () => {
    const state = baseState({
      couponCode: 'TEAM',
      couponDiscount: 5,
      promotionPromoCode: 'TEAM',
      selectedFreeGifts: { promo1: 'g1' },
      selectedBogoSecond: { promo2: ['p2'] },
    });
    const next = cartReducer(state, { type: 'REMOVE_COUPON' });
    expect(next.selectedFreeGifts).toEqual({ promo1: 'g1' });
    expect(next.selectedBogoSecond).toEqual({ promo2: ['p2'] });
  });
});

describe('cartReducer / SET_PROMOTION_CALCULATION — сохранение выбора', () => {
  it('купон активен → BOGO подавлен (пустой bogoSecondItems), но выбор второго товара сохраняется', () => {
    const state = baseState({
      couponCode: 'TEAM',
      selectedBogoSecond: { promo1: ['p2'] },
    });
    const next = cartReducer(state, {
      type: 'SET_PROMOTION_CALCULATION',
      payload: calc({ bogoSecondItems: [] }),
    });
    // выбор не потерян → вернётся после удаления купона
    expect(next.selectedBogoSecond).toEqual({ promo1: ['p2'] });
  });

  it('без купона → selectedBogoSecond пересобирается из bogoSecondItems (движок — источник истины)', () => {
    const state = baseState({ selectedBogoSecond: { stale: ['x'] } });
    const next = cartReducer(state, {
      type: 'SET_PROMOTION_CALCULATION',
      payload: calc({
        bogoSecondItems: [{ promotionId: 'promo1', id: 'p2', productId: 'p2' }],
      }),
    });
    expect(next.selectedBogoSecond).toEqual({ promo1: ['p2'] });
  });

  it('selectedFreeGifts сохраняется, если выбор ещё валиден в freeGiftOffers; невалидный — отбрасывается', () => {
    const state = baseState({
      selectedFreeGifts: { promo1: 'g1', promoGone: 'gX' },
    });
    const next = cartReducer(state, {
      type: 'SET_PROMOTION_CALCULATION',
      payload: calc({
        freeGiftOffers: [
          { promotionId: 'promo1', promotionName: 'Gratis', label: '', options: [{ id: 'g1', productId: 'g1' }] },
        ],
      }),
    });
    expect(next.selectedFreeGifts).toEqual({ promo1: 'g1' });
  });

  it('payload=null → выбор очищается (корзина пуста)', () => {
    const state = baseState({
      selectedFreeGifts: { promo1: 'g1' },
      selectedBogoSecond: { promo2: ['p2'] },
    });
    const next = cartReducer(state, { type: 'SET_PROMOTION_CALCULATION', payload: null });
    expect(next.selectedFreeGifts).toEqual({});
    expect(next.selectedBogoSecond).toEqual({});
  });
});
