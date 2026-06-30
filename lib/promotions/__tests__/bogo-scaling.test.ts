import { describe, it, expect } from 'vitest';
import { calculatePromotions } from '../engine';

/**
 * BOGO («2. Artikel gratis / halber Preis»):
 *  - число доступных слотов награды = число подходящих платных единиц (из корзины);
 *  - КАЖДЫЙ слот клиент выбирает сам (2-й, 3-й, … n-й товар) или отказывается —
 *    первый выбор НЕ дублируется автоматически;
 *  - пока остаются незаполненные слоты, движок возвращает предложение (offer.remaining).
 */

const promo = {
  _id: 'bogo1',
  name: '2 für 1',
  type: 'bogo',
  bogoMode: 'free',
  enabled: true,
  validFrom: new Date('2020-01-01'),
  validTo: new Date('2100-01-01'),
  channel: 'all',
  audience: 'all',
  scope: 'products',
  priority: 0,
  weekdayScheduleEnabled: false,
  happyHourEnabled: false,
  activeDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  targetItems: [{ productId: 'p1' }, { productId: 'p2' }],
  targetProductIds: [],
  targetCategoryIds: [],
} as any;

const catalog = {
  bogo1: [
    { id: 'p1', productId: 'p1', name: 'Bayern Pizza', unitPrice: 10, effectivePrice: 0 },
    { id: 'p2', productId: 'p2', name: 'Salami Pizza', unitPrice: 12, effectivePrice: 0 },
  ],
};

const line = (productId: string, quantity: number, unitPrice = 10) => ({
  productId,
  name: productId,
  quantity,
  unitPrice,
  sizeName: '',
});

const sels = (...ids: string[]) => ids.map((productId) => ({ promotionId: 'bogo1', productId }));

function calc(items: any[], selectedBogoSecond: any[] = []) {
  return calculatePromotions(items, [promo], { bogoCatalog: catalog, selectedBogoSecond });
}

const rewardUnits = (c: ReturnType<typeof calc>) =>
  c.bogoSecondItems.reduce((n, i) => n + i.quantity, 0);

describe('BOGO per-slot choice (idempotent slots from cart, manual reward choice)', () => {
  it('слотов = числу подходящих единиц; без выбора → предложение, наград нет', () => {
    const c = calc([line('p1', 3)]);
    expect(c.bogoSecondItems).toHaveLength(0);
    expect(c.bogoSecondOffers).toHaveLength(1);
    expect(c.bogoSecondOffers[0].remaining).toBe(3);
  });

  it('частичный выбор → награда только за выбранные слоты, остальное предлагается', () => {
    const c = calc([line('p1', 3)], sels('p1')); // выбрал 1 из 3
    expect(rewardUnits(c)).toBe(1);
    expect(c.bogoSecondOffers[0].remaining).toBe(2);
  });

  it('каждый слот — отдельный выбор: 3 единицы, 3 выбора → 3 награды, без предложения', () => {
    const c = calc([line('p1', 3)], sels('p1', 'p1', 'p1'));
    expect(rewardUnits(c)).toBe(3);
    expect(c.bogoSecondOffers).toHaveLength(0);
  });

  it('РАЗНЫЕ выбранные награды показываются отдельными строками', () => {
    const c = calc([line('p1', 2), line('p2', 1, 12)], sels('p1', 'p2', 'p2'));
    // 3 слота, 3 выбора: p1×1, p2×2 → 2 строки, суммарно 3 награды
    expect(c.bogoSecondItems).toHaveLength(2);
    expect(rewardUnits(c)).toBe(3);
    expect(c.bogoSecondOffers).toHaveLength(0);
  });

  it('одинаковые выбранные награды агрегируются в строку с количеством', () => {
    const c = calc([line('p1', 4)], sels('p1', 'p1', 'p1', 'p1'));
    expect(c.bogoSecondItems).toHaveLength(1);
    expect(c.bogoSecondItems[0].quantity).toBe(4);
  });

  it('выбор не превышает число слотов (уменьшение количества)', () => {
    // было 3 выбора, корзина уменьшилась до 1 единицы → только 1 награда
    const c = calc([line('p1', 1)], sels('p1', 'p1', 'p1'));
    expect(rewardUnits(c)).toBe(1);
    expect(c.bogoSecondOffers).toHaveLength(0); // слот заполнен
  });
});

describe('BOGO half-price picker keeps size-specific prices', () => {
  const halfPricePromo = {
    ...promo,
    bogoMode: 'half_price',
    targetItems: [{ productId: 'bbq' }],
  } as any;
  const bbqCatalog = {
    bogo1: [
      {
        id: 'bbq|small',
        productId: 'bbq',
        sizeName: 'small',
        name: 'BBQ — Small',
        unitPrice: 15.8,
        effectivePrice: 7.9,
      },
      {
        id: 'bbq|medium',
        productId: 'bbq',
        sizeName: 'medium',
        name: 'BBQ — Medium',
        unitPrice: 20.8,
        effectivePrice: 10.4,
      },
      {
        id: 'bbq|large',
        productId: 'bbq',
        sizeName: 'large',
        name: 'BBQ — Large',
        unitPrice: 30.8,
        effectivePrice: 15.4,
      },
    ],
  };

  it('не копирует цену выбранного размера на остальные размеры того же товара', () => {
    const c = calculatePromotions(
      [{ productId: 'bbq', name: 'BBQ', quantity: 1, unitPrice: 15.8, sizeName: 'small' }],
      [halfPricePromo],
      { bogoCatalog: bbqCatalog }
    );

    const offer = c.bogoSecondOffers[0];
    expect(offer.options.map((o) => [o.id, o.effectivePrice])).toEqual([
      ['bbq|small', 7.9],
      ['bbq|medium', 10.4],
      ['bbq|large', 15.4],
    ]);
  });

  it('использует цену из корзины только для точно совпавшего размера', () => {
    const c = calculatePromotions(
      // 16.8 имитирует тот же size + выбранный extra; другие размеры берутся из каталога.
      [{ productId: 'bbq', name: 'BBQ', quantity: 1, unitPrice: 16.8, sizeName: 'small' }],
      [halfPricePromo],
      { bogoCatalog: bbqCatalog }
    );

    const prices = Object.fromEntries(
      c.bogoSecondOffers[0].options.map((o) => [o.id, o.effectivePrice])
    );
    expect(prices['bbq|small']).toBe(8.4);
    expect(prices['bbq|medium']).toBe(10.4);
    expect(prices['bbq|large']).toBe(15.4);
  });
});
