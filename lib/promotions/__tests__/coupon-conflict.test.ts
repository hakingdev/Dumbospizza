import { describe, it, expect } from 'vitest';
import { calculatePromotions } from '../engine';
import {
  isMoneyDiscountType,
  hasActiveMoneyDiscount,
  getConflictingPromotions,
} from '../coupon-conflict';
import type { PromotionCalculationResult } from '../types';

/**
 * Совместимость Angebot и Coupon / Promo-Code.
 * Денежные акции (percent/fixed/bogo) не комбинируются с купоном; Gratis — комбинируется.
 * AC #1–#8 проверяются на расчёте корзины (calculatePromotions + excludeMoneyDiscounts).
 */

// --- фикстуры ---------------------------------------------------------------

const makePromo = (overrides: Record<string, unknown>) =>
  ({
    _id: 'promo-' + Math.random().toString(36).slice(2),
    name: 'Aktion',
    enabled: true,
    validFrom: new Date('2020-01-01'),
    validTo: new Date('2100-01-01'),
    channel: 'all',
    audience: 'all',
    scope: 'products',
    weekdayScheduleEnabled: false,
    happyHourEnabled: false,
    activeDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    priority: 0,
    targetProductIds: [],
    targetCategoryIds: [],
    targetItems: [],
    rewardItems: [],
    giftProductIds: [],
    ...overrides,
  }) as any;

const cartItem = (over: Record<string, unknown> = {}) => ({
  productId: 'p1',
  name: 'Bayern Pizza',
  quantity: 1,
  unitPrice: 10,
  sizeName: '',
  ...over,
});

const percentPromo = () =>
  makePromo({ type: 'percent_discount', percentValue: 10, targetProductIds: ['p1'] });
const fixedPromo = () =>
  makePromo({ type: 'fixed_discount', fixedValue: 5, targetProductIds: ['p1'] });
const gratisPromo = () =>
  makePromo({
    type: 'gratis_article',
    gratisTrigger: 'buy_product',
    targetProductIds: ['p1'],
    giftProductIds: ['gift1'],
    giftProductName: 'Gratis Cola',
  });
const bogoPromo = (mode: 'half_price' | 'free') =>
  makePromo({ type: 'bogo', bogoMode: mode, targetItems: [{ productId: 'p1' }], rewardItems: [{ productId: 'p1' }] });

// BOGO нуждается в каталоге (>=2 опции) и выборе 2-го товара, чтобы дать скидку.
const bogoCatalogFor = (promoId: string, mode: 'half_price' | 'free') => ({
  [promoId]: [
    { id: 'p1', productId: 'p1', name: 'Bayern Pizza', unitPrice: 10, effectivePrice: mode === 'half_price' ? 5 : 0 },
    { id: 'p2', productId: 'p2', name: 'Salami', unitPrice: 10, effectivePrice: mode === 'half_price' ? 5 : 0 },
  ],
});

// --- helpers ----------------------------------------------------------------

describe('isMoneyDiscountType', () => {
  it('денежные типы → true', () => {
    expect(isMoneyDiscountType('percent_discount')).toBe(true);
    expect(isMoneyDiscountType('fixed_discount')).toBe(true);
    expect(isMoneyDiscountType('bogo')).toBe(true);
  });
  it('Gratis → false', () => {
    expect(isMoneyDiscountType('gratis_article')).toBe(false);
    expect(isMoneyDiscountType(undefined)).toBe(false);
  });
});

describe('hasActiveMoneyDiscount', () => {
  const calcWith = (promotionType: string, savedAmount: number): PromotionCalculationResult =>
    ({
      appliedPromotions: [
        { promotionId: 'x', promotionName: 'A', promotionType, savedAmount } as any,
      ],
    }) as any;

  it('денежная акция со скидкой → true', () => {
    expect(hasActiveMoneyDiscount(calcWith('percent_discount', 2))).toBe(true);
    expect(hasActiveMoneyDiscount(calcWith('fixed_discount', 5))).toBe(true);
    expect(hasActiveMoneyDiscount(calcWith('bogo', 5))).toBe(true);
  });
  it('Gratis / нулевая скидка / пусто → false', () => {
    expect(hasActiveMoneyDiscount(calcWith('gratis_article', 0))).toBe(false);
    expect(hasActiveMoneyDiscount(calcWith('percent_discount', 0))).toBe(false);
    expect(hasActiveMoneyDiscount(null)).toBe(false);
    expect(getConflictingPromotions(null)).toEqual([]);
  });
});

// --- AC #1: Gratis + Coupon работают одновременно ---------------------------

describe('AC #1 — Gratis + Coupon совместимы', () => {
  it('Gratis применяется даже при активном купоне (excludeMoneyDiscounts)', () => {
    const items = [cartItem()];
    const promos = [gratisPromo()];
    const withCoupon = calculatePromotions(items, promos, { excludeMoneyDiscounts: true });
    expect(withCoupon.freeGifts).toHaveLength(1);
    expect(withCoupon.promotionDiscountTotal).toBe(0); // Gratis не уменьшает сумму
    expect(hasActiveMoneyDiscount(withCoupon)).toBe(false); // конфликта нет
  });
});

// --- AC #2/#3: Rabatt % и Rabatt € не комбинируются с купоном ----------------

describe('AC #2 — Rabatt Prozent vs Coupon', () => {
  const items = [cartItem()];
  it('без купона скидка применяется', () => {
    const calc = calculatePromotions(items, [percentPromo()]);
    expect(calc.promotionDiscountTotal).toBeCloseTo(1, 2); // 10% от 10€
    expect(hasActiveMoneyDiscount(calc)).toBe(true);
  });
  it('с купоном денежная акция подавлена', () => {
    const calc = calculatePromotions(items, [percentPromo()], { excludeMoneyDiscounts: true });
    expect(calc.promotionDiscountTotal).toBe(0);
    expect(hasActiveMoneyDiscount(calc)).toBe(false);
  });
});

describe('AC #3 — Rabatt Euro vs Coupon', () => {
  const items = [cartItem()];
  it('без купона скидка применяется', () => {
    const calc = calculatePromotions(items, [fixedPromo()]);
    expect(calc.promotionDiscountTotal).toBeCloseTo(5, 2);
    expect(hasActiveMoneyDiscount(calc)).toBe(true);
  });
  it('с купоном денежная акция подавлена', () => {
    const calc = calculatePromotions(items, [fixedPromo()], { excludeMoneyDiscounts: true });
    expect(calc.promotionDiscountTotal).toBe(0);
  });
});

// --- AC #4/#5: BOGO half_price и free не комбинируются с купоном -------------

// 2+1: 2 подходящих единицы = 1 слот награды; подтверждённая награда заполняет
// его полностью (предложений не остаётся).
describe.each([
  ['half_price', 'AC #4 — Dritte Pizza zum halben Preis (2+1)', 5],
  ['free', 'AC #5 — Dritte Pizza gratis (2+1)', 10],
] as const)('%s', (mode, label, expectedSaving) => {
  const items = [cartItem({ quantity: 2 })]; // 2 подходящих единицы → 1 слот (2+1)
  const promo = bogoPromo(mode);
  const catalog = bogoCatalogFor(String(promo._id), mode);
  const selection = [{ promotionId: String(promo._id), productId: 'p1' }];

  it(`${label}: без купона награда и скидка есть`, () => {
    const calc = calculatePromotions(items, [promo], {
      bogoCatalog: catalog,
      selectedBogoSecond: selection,
    });
    expect(calc.bogoSecondItems).toHaveLength(1);
    expect(calc.bogoSecondItems[0].quantity).toBe(1); // только подтверждённая награда
    expect(calc.promotionDiscountTotal).toBeCloseTo(expectedSaving, 2);
    // единственный слот заполнен → предложений больше нет
    expect(calc.bogoSecondOffers).toHaveLength(0);
    expect(hasActiveMoneyDiscount(calc)).toBe(true);
  });

  it(`${label}: с купоном BOGO подавлен`, () => {
    const calc = calculatePromotions(items, [promo], {
      bogoCatalog: catalog,
      selectedBogoSecond: selection,
      excludeMoneyDiscounts: true,
    });
    expect(calc.bogoSecondItems).toHaveLength(0);
    expect(calc.promotionDiscountTotal).toBe(0);
    expect(hasActiveMoneyDiscount(calc)).toBe(false);
  });
});

// --- AC #7/#8: финал никогда не содержит обе скидки; не зависит от порядка ----

describe('AC #7/#8 — порядок применения не влияет, двойной скидки нет', () => {
  it('Gratis остаётся, денежные акции подавлены — независимо от «порядка»', () => {
    const items = [cartItem({ quantity: 2 })];
    const bogo = bogoPromo('half_price');
    const promos = [percentPromo(), fixedPromo(), gratisPromo(), bogo];
    const ctx = {
      excludeMoneyDiscounts: true,
      bogoCatalog: bogoCatalogFor(String(bogo._id), 'half_price'),
      selectedBogoSecond: [{ promotionId: String(bogo._id), productId: 'p1' }],
    };

    // «Сначала купон, потом акция» и «сначала акция, потом купон» — это один и тот же
    // вход для чистого расчёта: результат обязан совпадать.
    const a = calculatePromotions(items, promos, ctx);
    const b = calculatePromotions([...items], [...promos], { ...ctx });

    expect(a.promotionDiscountTotal).toBe(0);
    expect(a.bogoSecondItems).toHaveLength(0);
    expect(a.freeGifts).toHaveLength(1); // Gratis совместим
    expect(hasActiveMoneyDiscount(a)).toBe(false);
    expect(b).toEqual(a);
  });
});
