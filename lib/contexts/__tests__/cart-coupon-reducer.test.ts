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

describe('cartReducer / промокод удаляет combo (Angebot не комбинируется с промокодом)', () => {
  const comboState = () =>
    baseState({
      items: [
        { id: 'reg', productId: 'reg', name: 'Pizza', price: 12, quantity: 1 },
        { id: 'c:p1', name: 'Bayern', price: 16.9, quantity: 1, comboId: 'c', comboRole: 'pizza' },
        { id: 'c:d0', name: 'Cola', price: 0, quantity: 1, comboId: 'c', comboRole: 'drink' },
        { id: 'c:discount', name: 'Kombi-Rabatt', price: -5, quantity: 1, comboId: 'c', comboRole: 'discount' },
      ],
    });

  it('APPLY_COUPON удаляет ВСЕ combo-позиции и пересчитывает сумму только по обычным товарам', () => {
    const next = cartReducer(comboState(), {
      type: 'APPLY_COUPON',
      payload: { code: 'TEAM', discount: 3.6 }, // 30% от 12 €
    });
    expect(next.items.map((i: any) => i.id)).toEqual(['reg']); // combo полностью удалён
    expect(next.items.some((i: any) => i.comboId)).toBe(false);
    expect(next.subtotal).toBeCloseTo(12, 2);
    expect(next.couponCode).toBe('TEAM');
    expect(next.total).toBeCloseTo(12 - 3.6, 2); // купон только по обычным товарам
  });

  it('combo-only корзина + APPLY_COUPON → корзина без combo (пустая)', () => {
    const state = baseState({
      items: [
        { id: 'c:p1', name: 'Bayern', price: 16.9, quantity: 1, comboId: 'c', comboRole: 'pizza' },
        { id: 'c:discount', name: 'Kombi-Rabatt', price: -5, quantity: 1, comboId: 'c', comboRole: 'discount' },
      ],
    });
    const next = cartReducer(state, { type: 'APPLY_COUPON', payload: { code: 'TEAM', discount: 0 } });
    expect(next.items).toEqual([]);
    expect(next.subtotal).toBe(0);
  });

  it('SET_PROMOTION_PROMO_CODE с кодом удаляет combo; снятие кода (undefined) товары не трогает', () => {
    const applied = cartReducer(comboState(), { type: 'SET_PROMOTION_PROMO_CODE', payload: 'TEAM' });
    expect(applied.items.some((i: any) => i.comboId)).toBe(false);
    expect(applied.promotionPromoCode).toBe('TEAM');

    const regularOnly = baseState({ items: [{ id: 'reg', name: 'Pizza', price: 12, quantity: 1 }] });
    const removed = cartReducer(regularOnly, { type: 'SET_PROMOTION_PROMO_CODE', payload: undefined });
    expect(removed.items.map((i: any) => i.id)).toEqual(['reg']);
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

  it('без купона → сохраняет ещё НЕ разрешённый, но валидный выбор BOGO, пока оффер открыт (bug: 2. Gratis-Pizza исчезала)', () => {
    const offer = {
      promotionId: 'promo1', promotionName: 'BOGO', bogoMode: 'free', label: '',
      options: [{ id: 'p2|ca. 20x20', productId: 'p2', sizeName: 'ca. 20x20', name: 'X', unitPrice: 8.9, effectivePrice: 0 }],
    };
    const state = baseState({ selectedBogoSecond: { promo1: ['p2|ca. 20x20'] } });
    // Промежуточный пересчёт (например, после выбора подарка) ещё не вернул bogoSecondItems
    const next = cartReducer(state, {
      type: 'SET_PROMOTION_CALCULATION',
      payload: calc({ bogoSecondItems: [], bogoSecondOffers: [offer] }),
    });
    expect(next.selectedBogoSecond).toEqual({ promo1: ['p2|ca. 20x20'] });
  });

  it('без купона → невалидный выбор BOGO (нет в опциях оффера) отбрасывается', () => {
    const offer = {
      promotionId: 'promo1', promotionName: 'BOGO', bogoMode: 'free', label: '',
      options: [{ id: 'p2|ca. 20x20', productId: 'p2', sizeName: 'ca. 20x20', name: 'X', unitPrice: 8.9, effectivePrice: 0 }],
    };
    const state = baseState({ selectedBogoSecond: { promo1: ['gone'] } });
    const next = cartReducer(state, {
      type: 'SET_PROMOTION_CALCULATION',
      payload: calc({ bogoSecondItems: [], bogoSecondOffers: [offer] }),
    });
    expect(next.selectedBogoSecond).toEqual({});
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
