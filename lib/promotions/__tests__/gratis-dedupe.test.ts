import { describe, it, expect } from 'vitest';
import { calculatePromotions } from '../engine';
import {
  dedupeFreeGiftsByProduct,
  applySelectedFreeGifts,
  resolveFreeGiftsForOrder,
} from '../gifts';
import type { PromotionCalculationResult, PromotionFreeGift } from '../types';

/**
 * Бизнес-правило: «один физический товар (productId) максимум раз».
 * Если несколько gratis-акций дают один и тот же товар (пересекающиеся пороги или
 * списки), клиент получает его ОДИН раз — в попапе, в корзине и в заказе.
 */

const makeGratis = (
  _id: string,
  giftProductIds: string[],
  over: Record<string, unknown> = {}
) =>
  ({
    _id,
    name: `Gratis ${_id}`,
    type: 'gratis_article',
    giftProductName: 'Wasser',
    enabled: true,
    validFrom: new Date('2020-01-01'),
    validTo: new Date('2100-01-01'),
    channel: 'all',
    audience: 'all',
    weekdayScheduleEnabled: false,
    happyHourEnabled: false,
    activeDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    gratisTrigger: 'min_order',
    minOrderAmount: 20,
    targetProductIds: [],
    targetCategoryIds: [],
    targetItems: [],
    rewardItems: [],
    giftProductIds,
    ...over,
  }) as any;

const cart = [{ productId: 'pizza1', name: 'Pizza', quantity: 1, unitPrice: 30 }]; // 30 €

describe('engine — дедуп gratis по физическому товару', () => {
  it('две single-item акции на один товар → один авто-подарок', () => {
    const calc = calculatePromotions(cart, [
      makeGratis('g20', ['wasser'], { minOrderAmount: 20 }),
      makeGratis('g25', ['wasser'], { minOrderAmount: 25 }),
    ]);
    const waters = calc.freeGifts.filter((g) => g.productId === 'wasser');
    expect(waters).toHaveLength(1);
  });

  it('два разных подарка (вода + десерт) → оба остаются', () => {
    const calc = calculatePromotions(cart, [
      makeGratis('g20', ['wasser'], { minOrderAmount: 20 }),
      makeGratis('g30', ['dessert'], { minOrderAmount: 25, giftProductName: 'Dessert' }),
    ]);
    expect(calc.freeGifts.map((g) => g.productId).sort()).toEqual(['dessert', 'wasser']);
  });

  it('авто-подарок убирает свой товар из опций мульти-оффера выбора', () => {
    const calc = calculatePromotions(cart, [
      makeGratis('auto', ['wasser'], { minOrderAmount: 20 }),
      makeGratis('pick', ['wasser', 'sprite'], { minOrderAmount: 25 }),
    ]);
    expect(calc.freeGifts.map((g) => g.productId)).toEqual(['wasser']);
    // оффер pick больше не предлагает уже выданную воду — только sprite
    const pick = calc.freeGiftOffers.find((o) => o.promotionId === 'pick');
    expect(pick?.options.map((o) => o.productId)).toEqual(['sprite']);
  });

  it('оффер, у которого все опции уже выданы авто-подарками, исчезает', () => {
    const calc = calculatePromotions(cart, [
      makeGratis('auto', ['wasser'], { minOrderAmount: 20 }),
      makeGratis('pick', ['wasser'], { minOrderAmount: 25, giftProductName: 'Wasser' }),
    ]);
    // обе single-item → обе авто; дедуп → один подарок, офферов нет
    expect(calc.freeGifts.map((g) => g.productId)).toEqual(['wasser']);
    expect(calc.freeGiftOffers).toHaveLength(0);
  });
});

describe('gifts helpers — дедуп при разрешении выбора', () => {
  const baseCalc = (over: Partial<PromotionCalculationResult> = {}): PromotionCalculationResult =>
    ({
      subtotal: 30,
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
    }) as PromotionCalculationResult;

  const autoWater: PromotionFreeGift = {
    productId: 'wasser',
    sizeName: undefined,
    name: 'Wasser',
    quantity: 1,
    promotionId: 'auto',
    promotionName: 'Gratis auto',
    label: 'Gratis-Artikel',
  };

  const pickOffer = {
    promotionId: 'pick',
    promotionName: 'Gratis pick',
    label: 'wählen Sie 1 aus',
    options: [
      { id: 'wasser', productId: 'wasser', name: 'Wasser' },
      { id: 'sprite', productId: 'sprite', name: 'Sprite' },
    ],
  };

  it('dedupeFreeGiftsByProduct схлопывает один товар', () => {
    const out = dedupeFreeGiftsByProduct([autoWater, { ...autoWater, promotionId: 'auto2' }]);
    expect(out).toHaveLength(1);
    expect(out[0].promotionId).toBe('auto'); // первое вхождение
  });

  it('applySelectedFreeGifts: выбор уже выданного товара не дублируется', () => {
    const calc = baseCalc({ freeGifts: [autoWater], freeGiftOffers: [pickOffer] });
    const out = applySelectedFreeGifts(calc, [{ promotionId: 'pick', productId: 'wasser' }]);
    expect(out.freeGifts.filter((g) => g.productId === 'wasser')).toHaveLength(1);
  });

  it('resolveFreeGiftsForOrder: заказ не получает один товар дважды', () => {
    const calc = baseCalc({ freeGifts: [autoWater], freeGiftOffers: [pickOffer] });
    const { freeGifts, error } = resolveFreeGiftsForOrder(calc, [
      { promotionId: 'pick', productId: 'wasser' },
    ]);
    expect(error).toBeUndefined();
    expect(freeGifts.filter((g) => g.productId === 'wasser')).toHaveLength(1);
  });

  it('resolveFreeGiftsForOrder: выбор ДРУГОГО товара добавляется (sprite ≠ wasser)', () => {
    const calc = baseCalc({ freeGifts: [autoWater], freeGiftOffers: [pickOffer] });
    const { freeGifts } = resolveFreeGiftsForOrder(calc, [
      { promotionId: 'pick', productId: 'sprite' },
    ]);
    expect(freeGifts.map((g) => g.productId).sort()).toEqual(['sprite', 'wasser']);
  });
});
