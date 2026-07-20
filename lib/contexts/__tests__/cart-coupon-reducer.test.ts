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
    declinedFreeGifts: {},
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
      selectedBogoSecond: { promo2: [{ itemId: 'A', productId: 'p2' }] },
    });
    const next = cartReducer(state, { type: 'REMOVE_COUPON' });
    expect(next.selectedFreeGifts).toEqual({ promo1: 'g1' });
    expect(next.selectedBogoSecond).toEqual({ promo2: [{ itemId: 'A', productId: 'p2' }] });
  });
});

describe('cartReducer / купон и промокод не трогают состав корзины', () => {
  const cartState = () =>
    baseState({
      items: [{ id: 'reg', productId: 'reg', name: 'Pizza', price: 12, quantity: 1 }],
    });

  it('APPLY_COUPON сохраняет товары и считает скидку по ним', () => {
    const next = cartReducer(cartState(), {
      type: 'APPLY_COUPON',
      payload: { code: 'TEAM', discount: 3.6 }, // 30% от 12 €
    });
    expect(next.items.map((i: any) => i.id)).toEqual(['reg']);
    expect(next.subtotal).toBeCloseTo(12, 2);
    expect(next.couponCode).toBe('TEAM');
    expect(next.total).toBeCloseTo(12 - 3.6, 2);
  });

  it('SET_PROMOTION_PROMO_CODE (установка и снятие) товары не трогает', () => {
    const applied = cartReducer(cartState(), { type: 'SET_PROMOTION_PROMO_CODE', payload: 'TEAM' });
    expect(applied.items.map((i: any) => i.id)).toEqual(['reg']);
    expect(applied.promotionPromoCode).toBe('TEAM');

    const removed = cartReducer(applied, { type: 'SET_PROMOTION_PROMO_CODE', payload: undefined });
    expect(removed.items.map((i: any) => i.id)).toEqual(['reg']);
    expect(removed.promotionPromoCode).toBeUndefined();
  });
});

describe('cartReducer / SET_PROMOTION_CALCULATION — сохранение выбора', () => {
  it('купон активен → BOGO подавлен (пустой bogoSecondItems), но выбор второго товара сохраняется', () => {
    const state = baseState({
      couponCode: 'TEAM',
      selectedBogoSecond: { promo1: [{ itemId: 'A', productId: 'p2' }] },
    });
    const next = cartReducer(state, {
      type: 'SET_PROMOTION_CALCULATION',
      payload: calc({ bogoSecondItems: [] }),
    });
    // выбор (с привязкой к пицце) не потерян → вернётся после удаления купона
    expect(next.selectedBogoSecond).toEqual({ promo1: [{ itemId: 'A', productId: 'p2' }] });
  });

  it('без купона → selectedBogoSecond пересобирается из bogoSecondItems (движок — источник истины)', () => {
    const state = baseState({ selectedBogoSecond: { stale: [{ itemId: 'a', productId: 'x' }] } });
    const next = cartReducer(state, {
      type: 'SET_PROMOTION_CALCULATION',
      payload: calc({
        bogoSecondItems: [{ promotionId: 'promo1', id: 'p2', productId: 'p2', quantity: 1 }],
      }),
    });
    // stale-выбор без подтверждения движком отброшен; принятая движком награда без
    // привязки остаётся (страховка от потери выбора) — itemId=''.
    expect(next.selectedBogoSecond).toEqual({ promo1: [{ itemId: '', productId: 'p2' }] });
  });

  it('без купона → сохраняет ещё НЕ разрешённый, но валидный выбор BOGO, пока оффер открыт (bug: 2. Gratis-Pizza исчезала)', () => {
    const offer = {
      promotionId: 'promo1', promotionName: 'BOGO', bogoMode: 'free', label: '',
      options: [{ id: 'p2|ca. 20x20', productId: 'p2', sizeName: 'ca. 20x20', name: 'X', unitPrice: 8.9, effectivePrice: 0 }],
    };
    const state = baseState({
      selectedBogoSecond: { promo1: [{ itemId: 'A', productId: 'p2|ca. 20x20' }] },
    });
    // Промежуточный пересчёт (например, после выбора подарка) ещё не вернул bogoSecondItems
    const next = cartReducer(state, {
      type: 'SET_PROMOTION_CALCULATION',
      payload: calc({ bogoSecondItems: [], bogoSecondOffers: [offer] }),
    });
    // Выбор валиден (есть в опциях оффера) → сохраняется ВМЕСТЕ с привязкой к пицце.
    expect(next.selectedBogoSecond).toEqual({ promo1: [{ itemId: 'A', productId: 'p2|ca. 20x20' }] });
  });

  it('без купона → невалидный выбор BOGO (нет в опциях оффера) отбрасывается', () => {
    const offer = {
      promotionId: 'promo1', promotionName: 'BOGO', bogoMode: 'free', label: '',
      options: [{ id: 'p2|ca. 20x20', productId: 'p2', sizeName: 'ca. 20x20', name: 'X', unitPrice: 8.9, effectivePrice: 0 }],
    };
    const state = baseState({
      selectedBogoSecond: { promo1: [{ itemId: 'A', productId: 'gone' }] },
    });
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

  it('declinedFreeGifts сохраняется только для актуального незаполненного gift-offer', () => {
    const state = baseState({
      declinedFreeGifts: { promo1: true, promoGone: true },
    });
    const next = cartReducer(state, {
      type: 'SET_PROMOTION_CALCULATION',
      payload: calc({
        freeGiftOffers: [
          { promotionId: 'promo1', promotionName: 'Gratis', label: '', options: [{ id: 'g1', productId: 'g1' }] },
        ],
      }),
    });
    expect(next.declinedFreeGifts).toEqual({ promo1: true });
  });

  it('выбор подарка очищает предыдущий отказ по тому же offer', () => {
    const state = baseState({
      declinedFreeGifts: { promo1: true, promo2: true },
    });
    const next = cartReducer(state, {
      type: 'SET_SELECTED_FREE_GIFT',
      payload: { promotionId: 'promo1', productId: 'g1' },
    });
    expect(next.selectedFreeGifts).toEqual({ promo1: 'g1' });
    expect(next.declinedFreeGifts).toEqual({ promo2: true });
  });

  it('изменение корзины сбрасывает отказ от gift-offer как устаревший', () => {
    const state = baseState({
      declinedFreeGifts: { promo1: true },
    });
    const next = cartReducer(state, {
      type: 'ADD_ITEM',
      payload: { id: 'p1', productId: 'p1', name: 'Pizza', price: 10, basePrice: 10, quantity: 1 },
    });
    expect(next.declinedFreeGifts).toEqual({});
  });

  it('тот же контент выбора → СОХРАНЯЕТ ссылки (нет бесконечного пересчёта / мигания попапа)', () => {
    const state = baseState({
      selectedFreeGifts: { promo1: 'g1' },
      selectedBogoSecond: { promoB: [{ itemId: 'A', productId: 'p2' }] },
      declinedFreeGifts: {},
    });
    const next = cartReducer(state, {
      type: 'SET_PROMOTION_CALCULATION',
      payload: calc({
        freeGifts: [{ promotionId: 'promo1', productId: 'g1' }],
        bogoSecondItems: [{ promotionId: 'promoB', id: 'p2', productId: 'p2', quantity: 1 }],
      }),
    });
    // Контент не изменился (та же привязка) → ссылки должны остаться ПРЕЖНИМИ (иначе
    // deps recalculatePromotions меняются на каждый пересчёт → бесконечный цикл).
    expect(next.selectedFreeGifts).toBe(state.selectedFreeGifts);
    expect(next.selectedBogoSecond).toBe(state.selectedBogoSecond);
    expect(next.declinedFreeGifts).toBe(state.declinedFreeGifts);
  });

  it('изменившийся контент выбора → НОВАЯ ссылка (пересчёт обязан сработать)', () => {
    const state = baseState({ selectedBogoSecond: { promoB: [{ itemId: 'A', productId: 'p2' }] } });
    const next = cartReducer(state, {
      type: 'SET_PROMOTION_CALCULATION',
      payload: calc({
        bogoSecondItems: [
          { promotionId: 'promoB', id: 'p2', productId: 'p2', quantity: 2 },
        ],
      }),
    });
    expect(next.selectedBogoSecond).not.toBe(state.selectedBogoSecond);
    // 1 привязанный выбор + 1 принятая движком награда без привязки (страховка).
    expect(next.selectedBogoSecond).toEqual({
      promoB: [
        { itemId: 'A', productId: 'p2' },
        { itemId: '', productId: 'p2' },
      ],
    });
  });

  it('payload=null → выбор очищается (корзина пуста)', () => {
    const state = baseState({
      selectedFreeGifts: { promo1: 'g1' },
      declinedFreeGifts: { promo1: true },
      selectedBogoSecond: { promo2: [{ itemId: 'A', productId: 'p2' }] },
    });
    const next = cartReducer(state, { type: 'SET_PROMOTION_CALCULATION', payload: null });
    expect(next.selectedFreeGifts).toEqual({});
    expect(next.declinedFreeGifts).toEqual({});
    expect(next.selectedBogoSecond).toEqual({});
  });
});

/**
 * Главный сценарий бага: BOGO-награда («вторая пицца») должна быть привязана к
 * конкретной квалифицирующей пицце (той, после которой выпало Angebot). Удаление
 * этой пиццы убирает именно её награду, а награда оставшейся пиццы сохраняется —
 * раньше при сжатии слотов движок отбрасывал последнюю по порядку (т.е. награду
 * ОСТАВШЕЙСЯ пиццы), и удаление «выглядело случайным».
 */
describe('cartReducer / BOGO-награда привязана к конкретной пицце', () => {
  const item = (id: string, productId: string, quantity = 1): any => ({
    id,
    productId,
    name: productId,
    price: 10,
    basePrice: 10,
    quantity,
    size: { id: 's', name: '' },
  });

  const offerCalc = (qualifying: Array<{ productId: string; sizeName?: string }>) =>
    calc({
      bogoSecondOffers: [
        {
          promotionId: 'promoB',
          promotionName: 'BOGO',
          bogoMode: 'free',
          label: '',
          options: [
            { id: 'r1', productId: 'r1', name: 'R1', unitPrice: 10, effectivePrice: 0 },
            { id: 'r2', productId: 'r2', name: 'R2', unitPrice: 10, effectivePrice: 0 },
          ],
          remaining: 1,
          qualifyingItems: qualifying,
        },
      ],
    });

  it('SET_SELECTED_BOGO_SECOND привязывает награду к последней подходящей пицце со свободным слотом', () => {
    const state = baseState({
      items: [item('A', 'pA'), item('B', 'pB')],
      promotionCalculation: offerCalc([{ productId: 'pA' }, { productId: 'pB' }]),
      selectedBogoSecond: { promoB: [{ itemId: 'A', productId: 'r1' }] }, // слот A уже занят
    });
    const next = cartReducer(state, {
      type: 'SET_SELECTED_BOGO_SECOND',
      payload: { promotionId: 'promoB', productId: 'r2' },
    });
    expect(next.selectedBogoSecond).toEqual({
      promoB: [
        { itemId: 'A', productId: 'r1' },
        { itemId: 'B', productId: 'r2' },
      ],
    });
  });

  it('REMOVE_ITEM убирает награду УДАЛЁННОЙ пиццы, сохраняя награду оставшейся (главный баг)', () => {
    const state = baseState({
      items: [item('A', 'pA'), item('B', 'pB')],
      selectedBogoSecond: {
        promoB: [
          { itemId: 'A', productId: 'r1' },
          { itemId: 'B', productId: 'r2' },
        ],
      },
    });
    const next = cartReducer(state, { type: 'REMOVE_ITEM', payload: 'A' });
    expect(next.items.map((i: any) => i.id)).toEqual(['B']);
    expect(next.selectedBogoSecond).toEqual({ promoB: [{ itemId: 'B', productId: 'r2' }] });
  });

  it('REMOVE_ITEM единственной награды акции очищает ключ акции', () => {
    const state = baseState({
      items: [item('A', 'pA')],
      selectedBogoSecond: { promoB: [{ itemId: 'A', productId: 'r1' }] },
    });
    const next = cartReducer(state, { type: 'REMOVE_ITEM', payload: 'A' });
    expect(next.selectedBogoSecond).toEqual({});
  });

  it('UPDATE_ITEM (уменьшение количества) обрезает лишние награды этой строки', () => {
    const state = baseState({
      items: [item('A', 'pA', 3)],
      selectedBogoSecond: {
        promoB: [
          { itemId: 'A', productId: 'r1' },
          { itemId: 'A', productId: 'r1' },
          { itemId: 'A', productId: 'r2' },
        ],
      },
    });
    const next = cartReducer(state, {
      type: 'UPDATE_ITEM',
      payload: { id: 'A', updates: { quantity: 1 } },
    });
    expect(next.selectedBogoSecond).toEqual({ promoB: [{ itemId: 'A', productId: 'r1' }] });
  });

  it('SET_SELECTED_BOGO_SECOND без qualifyingItems в расчёте → награда без привязки (itemId="")', () => {
    const state = baseState({
      items: [item('A', 'pA')],
      promotionCalculation: calc({ bogoSecondOffers: [] }),
    });
    const next = cartReducer(state, {
      type: 'SET_SELECTED_BOGO_SECOND',
      payload: { promotionId: 'promoB', productId: 'r1' },
    });
    expect(next.selectedBogoSecond).toEqual({ promoB: [{ itemId: '', productId: 'r1' }] });
  });
});
