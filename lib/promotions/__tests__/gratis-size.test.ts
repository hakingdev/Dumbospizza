import { describe, it, expect } from 'vitest';
import { calculatePromotions, getProductPromotionBadges } from '../engine';
import {
  getGiftItems,
  getGiftProductIdSet,
  giftOptionId,
  resolveFreeGiftsForOrder,
  enrichFreeGiftOffers,
} from '../gifts';

/**
 * Точный выбор подарка по товар+размер (giftItems), как у BOGO rewardItems.
 * Баннер — по товару (size-agnostic), подарок-пикер — по конкретному размеру,
 * сервер валидирует выбранный размер.
 */

const makeGratis = (over: Record<string, unknown> = {}) =>
  ({
    _id: 'g1',
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
    giftProductIds: [],
    giftItems: [],
    ...over,
  }) as any;

const cart = [{ productId: 'pizza', name: 'Pizza', quantity: 1, unitPrice: 25 }]; // >= 20

describe('getGiftItems / fallback', () => {
  it('берёт giftItems (товар+размер), дедуплицирует', () => {
    const items = getGiftItems(
      makeGratis({ giftItems: [{ productId: 'coca', sizeName: '0,33l' }, { productId: 'coca', sizeName: '0,33l' }, { productId: 'sprite', sizeName: '' }] })
    );
    expect(items).toEqual([
      { productId: 'coca', sizeName: '0,33l' },
      { productId: 'sprite', sizeName: '' },
    ]);
  });

  it('фолбэк на легаси giftProductIds (sizeName="")', () => {
    const items = getGiftItems(makeGratis({ giftProductIds: ['coca', 'fanta'] }));
    expect(items).toEqual([
      { productId: 'coca', sizeName: '' },
      { productId: 'fanta', sizeName: '' },
    ]);
  });

  it('getGiftProductIdSet — уникальные productId (для бейджа)', () => {
    expect(
      getGiftProductIdSet(makeGratis({ giftItems: [{ productId: 'coca', sizeName: '0,33l' }, { productId: 'coca', sizeName: '0,5l' }] }))
    ).toEqual(['coca']);
  });
});

describe('бейдж по giftItems (size-agnostic на карточке)', () => {
  it('баннер на товаре из giftItems, не на других', () => {
    const promos = [makeGratis({ giftItems: [{ productId: 'coca', sizeName: '0,33l' }] })];
    expect(getProductPromotionBadges('coca', undefined, promos, { channel: 'web' })).toHaveLength(1);
    expect(getProductPromotionBadges('fanta', undefined, promos, { channel: 'web' })).toHaveLength(0);
  });
});

describe('size-aware gift offer + серверная валидация', () => {
  const promos = [
    makeGratis({
      giftItems: [
        { productId: 'coca', sizeName: '0,33l' },
        { productId: 'coca', sizeName: '0,5l' },
        { productId: 'sprite', sizeName: '' },
      ],
    }),
  ];

  it('оффер содержит опции с id=productId|sizeName и sizeName', () => {
    const calc = calculatePromotions(cart, promos);
    const opts = calc.freeGiftOffers[0].options;
    expect(opts.map((o) => o.id).sort()).toEqual(['coca|0,33l', 'coca|0,5l', 'sprite']);
    expect(opts.find((o) => o.id === 'coca|0,33l')?.sizeName).toBe('0,33l');
  });

  it('сервер ПРИНИМАЕТ выбор конкретного размера', () => {
    const calc = calculatePromotions(cart, promos);
    const r = resolveFreeGiftsForOrder(calc, [{ promotionId: 'g1', productId: giftOptionId('coca', '0,33l') }]);
    expect(r.error).toBeFalsy();
    expect(r.freeGifts[0]).toMatchObject({ productId: 'coca', sizeName: '0,33l' });
  });

  it('сервер ОТКЛОНЯЕТ невыбранный размер того же товара', () => {
    const calc = calculatePromotions(cart, promos);
    const r = resolveFreeGiftsForOrder(calc, [{ promotionId: 'g1', productId: 'coca|0,99l' }]);
    expect(r.error).toBeTruthy();
    expect(r.freeGifts).toHaveLength(0);
  });

  it('enrich добавляет размер в название («Coca Cola 0,33l»)', () => {
    const calc = calculatePromotions(cart, promos);
    const enriched = enrichFreeGiftOffers(calc, new Map([['coca', { name: 'Coca Cola' }]]));
    const opt = enriched.freeGiftOffers[0].options.find((o) => o.id === 'coca|0,33l');
    expect(opt?.name).toBe('Coca Cola 0,33l');
  });

  it('один gift item → авто-подарок (freeGifts) с размером, без оффера', () => {
    const calc = calculatePromotions(cart, [makeGratis({ giftItems: [{ productId: 'coca', sizeName: '0,5l' }] })]);
    expect(calc.freeGiftOffers).toHaveLength(0);
    expect(calc.freeGifts[0]).toMatchObject({ productId: 'coca', sizeName: '0,5l' });
  });

  it('легаси: выбор по productId (без размера) всё ещё валиден', () => {
    const calc = calculatePromotions(cart, [makeGratis({ giftProductIds: ['coca', 'sprite'] })]);
    const r = resolveFreeGiftsForOrder(calc, [{ promotionId: 'g1', productId: 'coca' }]);
    expect(r.error).toBeFalsy();
    expect(r.freeGifts[0]).toMatchObject({ productId: 'coca' });
  });
});
