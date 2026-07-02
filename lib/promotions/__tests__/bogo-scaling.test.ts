import { describe, it, expect } from 'vitest';
import { calculatePromotions } from '../engine';
import { bogoRewardSlots } from '../bogo';

/**
 * BOGO = «2+1» (2 kaufen → 3. Artikel gratis / zum halben Preis):
 *  - слот награды за КАЖДЫЕ 2 подходящие платные единицы (2→1, 3→1, 4→2, …);
 *  - награду определяет ресторан (rewardItems): 1 позиция в каталоге = фикс,
 *    клиент только подтверждает в попапе; 2+ позиций = выбор из списка;
 *  - пока остаются незаполненные слоты, движок возвращает предложение (offer.remaining).
 */

const promo = {
  _id: 'bogo1',
  name: '2+1 Aktion',
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

// Награда, зафиксированная рестораном: ровно одна позиция в каталоге.
const fixedCatalog = {
  bogo1: [
    { id: 'p9', productId: 'p9', name: 'Margherita', unitPrice: 9, effectivePrice: 0 },
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

function calc(items: any[], selectedBogoSecond: any[] = [], bogoCatalog: any = catalog) {
  return calculatePromotions(items, [promo], { bogoCatalog, selectedBogoSecond });
}

const rewardUnits = (c: ReturnType<typeof calc>) =>
  c.bogoSecondItems.reduce((n, i) => n + i.quantity, 0);

describe('bogoRewardSlots (2+1: слот за каждую пару)', () => {
  it.each([
    [0, 0],
    [1, 0],
    [2, 1],
    [3, 1],
    [4, 2],
    [5, 2],
    [6, 3],
  ])('%i единиц → %i слотов', (units, slots) => {
    expect(bogoRewardSlots(units)).toBe(slots);
  });
});

describe('BOGO 2+1 (слот за каждые 2 единицы, награда от ресторана)', () => {
  it('1 единица → НЕТ ни предложения, ни награды (порог = 2)', () => {
    const c = calc([line('p1', 1)]);
    expect(c.bogoSecondItems).toHaveLength(0);
    expect(c.bogoSecondOffers).toHaveLength(0);
  });

  it('2 единицы → 1 слот: без подтверждения — предложение, наград нет', () => {
    const c = calc([line('p1', 2)]);
    expect(c.bogoSecondItems).toHaveLength(0);
    expect(c.bogoSecondOffers).toHaveLength(1);
    expect(c.bogoSecondOffers[0].remaining).toBe(1);
  });

  it('3 единицы → всё ещё 1 слот (неполная пара не считается)', () => {
    const c = calc([line('p1', 3)]);
    expect(c.bogoSecondOffers).toHaveLength(1);
    expect(c.bogoSecondOffers[0].remaining).toBe(1);
  });

  it('2 единицы + подтверждение → 1 награда, предложения больше нет', () => {
    const c = calc([line('p1', 2)], sels('p1'));
    expect(rewardUnits(c)).toBe(1);
    expect(c.bogoSecondOffers).toHaveLength(0);
  });

  it('4 единицы → 2 слота; частичное подтверждение оставляет remaining', () => {
    const c = calc([line('p1', 4)], sels('p1'));
    expect(rewardUnits(c)).toBe(1);
    expect(c.bogoSecondOffers).toHaveLength(1);
    expect(c.bogoSecondOffers[0].remaining).toBe(1);
  });

  it('одинаковые награды агрегируются в строку с количеством', () => {
    const c = calc([line('p1', 4)], sels('p1', 'p1'));
    expect(c.bogoSecondItems).toHaveLength(1);
    expect(c.bogoSecondItems[0].quantity).toBe(2);
    expect(c.bogoSecondOffers).toHaveLength(0);
  });

  it('РАЗНЫЕ выбранные награды показываются отдельными строками', () => {
    // 2+2 единицы → 2 слота; выбраны p1 и p2 → 2 строки
    const c = calc([line('p1', 2), line('p2', 2, 12)], sels('p1', 'p2'));
    expect(c.bogoSecondItems).toHaveLength(2);
    expect(rewardUnits(c)).toBe(2);
    expect(c.bogoSecondOffers).toHaveLength(0);
  });

  it('подтверждений больше, чем слотов → лишние отбрасываются', () => {
    // корзина уменьшилась: было 4 единицы (2 награды), осталось 2 → только 1 награда
    const c = calc([line('p1', 2)], sels('p1', 'p1'));
    expect(rewardUnits(c)).toBe(1);
    expect(c.bogoSecondOffers).toHaveLength(0); // слот заполнен
  });

  it('квалифицирующие единицы суммируются по разным строкам (1+1 = пара)', () => {
    const c = calc([line('p1', 1), line('p2', 1, 12)]);
    expect(c.bogoSecondOffers).toHaveLength(1);
    expect(c.bogoSecondOffers[0].remaining).toBe(1);
  });
});

describe('BOGO 2+1 с фиксированной наградой (1 позиция от ресторана)', () => {
  it('каталог из 1 позиции даёт оффер с единственной опцией', () => {
    const c = calc([line('p1', 2)], [], fixedCatalog);
    expect(c.bogoSecondOffers).toHaveLength(1);
    expect(c.bogoSecondOffers[0].options).toHaveLength(1);
    expect(c.bogoSecondOffers[0].options[0].productId).toBe('p9');
  });

  it('подтверждение фиксированной награды добавляет её отдельной строкой за 0 €', () => {
    const c = calc([line('p1', 2)], sels('p9'), fixedCatalog);
    expect(c.bogoSecondItems).toHaveLength(1);
    expect(c.bogoSecondItems[0].productId).toBe('p9');
    expect(c.bogoSecondItems[0].unitPrice).toBe(0);
    expect(c.bogoSecondItems[0].originalUnitPrice).toBe(9);
    expect(c.bogoSecondOffers).toHaveLength(0);
  });
});

describe('BOGO half-price (2+1) keeps size-specific prices', () => {
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
      [{ productId: 'bbq', name: 'BBQ', quantity: 2, unitPrice: 15.8, sizeName: 'small' }],
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
      [{ productId: 'bbq', name: 'BBQ', quantity: 2, unitPrice: 16.8, sizeName: 'small' }],
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
