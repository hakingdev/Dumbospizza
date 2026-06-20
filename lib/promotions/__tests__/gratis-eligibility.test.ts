import { describe, it, expect } from 'vitest';
import { getProductPromotionBadges, calculatePromotions } from '../engine';
import { resolveFreeGiftsForOrder } from '../gifts';

/**
 * Баг: баннер «Ein Getränk GRATIS» показывался на ВСЕХ напитках, хотя в Gratis-Angebot
 * выбраны конкретные товары (giftProductIds). Бейдж для gratis должен матчиться строго
 * по подарочным товарам; пустой список ≠ «все».
 */

const makeGratis = (giftProductIds: string[], over: Record<string, unknown> = {}) =>
  ({
    _id: 'gratis1',
    name: 'Ein Getränk gratis',
    type: 'gratis_article',
    badgeText: 'Ein Getränk GRATIS',
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

const badgeFor = (productId: string, promos: any[], categoryId?: string) =>
  getProductPromotionBadges(productId, categoryId, promos, { channel: 'web' });

describe('Gratis badge eligibility', () => {
  it('выбран только Sprite → баннер только на Sprite (DoD #1, #7)', () => {
    const promos = [makeGratis(['sprite033'])];
    expect(badgeFor('sprite033', promos)).toHaveLength(1);
    expect(badgeFor('sprite033', promos)[0].badgeText).toBe('Ein Getränk GRATIS');
  });

  it('Coca/Fanta/Wasser НЕ получают баннер, если не выбраны (DoD #2, основной баг)', () => {
    const promos = [makeGratis(['sprite033'])];
    expect(badgeFor('coca033', promos)).toHaveLength(0);
    expect(badgeFor('fanta033', promos)).toHaveLength(0);
    expect(badgeFor('wasser', promos)).toHaveLength(0);
  });

  it('выбрано несколько товаров → баннер на каждом из них', () => {
    const promos = [makeGratis(['coca033', 'sprite033'])];
    expect(badgeFor('coca033', promos)).toHaveLength(1);
    expect(badgeFor('sprite033', promos)).toHaveLength(1);
    expect(badgeFor('fanta033', promos)).toHaveLength(0);
  });

  it('пустой giftProductIds → НЕ показываем никому (пустая конфигурация ≠ все, DoD #10)', () => {
    const promos = [makeGratis([])];
    expect(badgeFor('sprite033', promos)).toHaveLength(0);
    expect(badgeFor('coca033', promos)).toHaveLength(0);
  });

  it('бейдж не зависит от категории товара (нельзя по имени категории, DoD #10)', () => {
    const promos = [makeGratis(['sprite033'])];
    // тот же напиток с категорией Getränke и без — поведение одинаковое (по gift-list)
    expect(badgeFor('coca033', promos, 'getraenke')).toHaveLength(0);
  });
});

describe('Gratis server-side eligibility (применение/отказ скидки)', () => {
  const cart = [{ productId: 'pizza1', name: 'Pizza', quantity: 1, unitPrice: 25 }]; // >= 20 → eligible

  it('подарок предлагается только из giftProductIds', () => {
    const calc = calculatePromotions(cart, [makeGratis(['sprite033', 'coca033'])]);
    // один подарок → freeGifts; несколько → freeGiftOffers (выбор из списка)
    const offered = (calc.freeGiftOffers[0]?.options || []).map((o) => o.productId);
    expect(offered.sort()).toEqual(['coca033', 'sprite033']);
  });

  it('сервер ОТКЛОНЯЕТ выбор подарка не из списка (DoD #4, #5 server)', () => {
    const calc = calculatePromotions(cart, [makeGratis(['sprite033', 'coca033'])]);
    const bad = resolveFreeGiftsForOrder(calc, [{ promotionId: 'gratis1', productId: 'fanta033' }]);
    expect(bad.error).toBeTruthy();
    expect(bad.freeGifts).toHaveLength(0);
  });

  it('сервер ПРИНИМАЕТ выбор подарка из списка (DoD #6 server)', () => {
    const calc = calculatePromotions(cart, [makeGratis(['sprite033', 'coca033'])]);
    const ok = resolveFreeGiftsForOrder(calc, [{ promotionId: 'gratis1', productId: 'sprite033' }]);
    expect(ok.error).toBeFalsy();
    expect(ok.freeGifts.map((g) => g.productId)).toContain('sprite033');
  });
});
