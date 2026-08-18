import { describe, expect, it } from 'vitest';
import {
  classifyStation,
  computeStationUnits,
  heuristicPrepMinutes,
  driveMinutesFromKm,
  roundEtaTo5,
  heuristicEta,
  isCookedStatus,
  normalizeEtaVerdict,
  splitActiveQueue,
  normalizeStaffing,
  DEFAULT_STAFFING,
  type EtaContext,
} from '../eta/order-eta';

describe('classifyStation', () => {
  it('пицца по категории', () => {
    expect(classifyStation({ category: 'Pizza', name: 'Margherita' })).toBe('pizza');
    expect(classifyStation({ category: 'Pizza', subcategory: 'Rund' })).toBe('pizza');
  });

  it('MakiLove/суши — станция sushi (в т.ч. Sushi Burger)', () => {
    expect(classifyStation({ category: 'MakiLove Sushi', name: 'Philadelphia Roll' })).toBe('sushi');
    expect(classifyStation({ category: 'MakiLove Sushi', name: 'Sushi Burger' })).toBe('sushi');
    expect(classifyStation({ category: 'MakiLove', subcategory: 'California' })).toBe('sushi');
  });

  it('напитки и десерты — без готовки', () => {
    expect(classifyStation({ category: 'Getränke', name: 'Coca-Cola 1L' })).toBe('none');
    expect(classifyStation({ category: 'Desserts', name: 'Tiramisu' })).toBe('none');
  });

  it('Beilagen/крылья/прочее — второй человек (fryer)', () => {
    expect(classifyStation({ category: 'Beilagen', name: 'Chicken Wings' })).toBe('fryer');
    expect(classifyStation({ category: 'Snacks', name: 'Pommes' })).toBe('fryer');
    expect(classifyStation({})).toBe('fryer');
  });
});

describe('computeStationUnits / heuristicPrepMinutes', () => {
  it('станции работают параллельно — берётся максимум', () => {
    const units = computeStationUnits([
      { category: 'Pizza', name: 'Salami', quantity: 2 }, // 16 мин у пиццайоло
      { category: 'Beilagen', name: 'Wings', quantity: 1 }, // 8 мин у второго
      { category: 'Getränke', name: 'Cola', quantity: 3 }, // 0
    ]);
    expect(units).toEqual({ pizza: 2, fryer: 1, sushi: 0 });
    expect(heuristicPrepMinutes(units)).toBe(16);
  });

  it('суши делают два человека: 4 ролла = 2 такта по 8 мин', () => {
    const units = computeStationUnits([
      { category: 'MakiLove Sushi', name: 'California', quantity: 4 },
    ]);
    expect(units.sushi).toBe(4);
    expect(heuristicPrepMinutes(units)).toBe(16);
  });

  it('только напитки — минимальная сборка 5 мин', () => {
    expect(heuristicPrepMinutes({ pizza: 0, fryer: 0, sushi: 0 })).toBe(5);
  });

  it('одна пицца — не меньше 10 мин', () => {
    expect(heuristicPrepMinutes({ pizza: 1, fryer: 0, sushi: 0 })).toBe(10);
  });
});

describe('heuristicPrepMinutes — персонал на смене', () => {
  it('2 повара: 4 пиццы за 2 такта вместо 4', () => {
    const units = { pizza: 4, fryer: 0, sushi: 0 };
    expect(heuristicPrepMinutes(units)).toBe(32); // дефолт: 1 повар
    expect(heuristicPrepMinutes(units, { pizzaCooks: 2, fryerHelpers: 1, sushiChefs: 2 })).toBe(16);
  });

  it('без помощника гарнир делает повар — последовательно с пиццей', () => {
    const units = { pizza: 2, fryer: 2, sushi: 0 };
    // С помощником: max(16, 16) = 16. Без: (2+2)/1 * 8 = 32.
    expect(heuristicPrepMinutes(units)).toBe(16);
    expect(heuristicPrepMinutes(units, { pizzaCooks: 1, fryerHelpers: 0, sushiChefs: 2 })).toBe(32);
    // Но два повара без помощника разбирают общую очередь вдвоём: 4/2 * 8 = 16.
    expect(heuristicPrepMinutes(units, { pizzaCooks: 2, fryerHelpers: 0, sushiChefs: 2 })).toBe(16);
  });

  it('один человек на суши: 4 ролла = 4 такта', () => {
    const units = { pizza: 0, fryer: 0, sushi: 4 };
    expect(heuristicPrepMinutes(units, { pizzaCooks: 1, fryerHelpers: 1, sushiChefs: 1 })).toBe(32);
  });
});

describe('normalizeStaffing', () => {
  it('валидные значения проходят как есть', () => {
    expect(normalizeStaffing({ pizzaCooks: 2, fryerHelpers: 0, sushiChefs: 1 })).toEqual({
      pizzaCooks: 2,
      fryerHelpers: 0,
      sushiChefs: 1,
    });
  });

  it('мусор и выход за диапазон → дефолты по полю', () => {
    expect(normalizeStaffing(undefined)).toEqual(DEFAULT_STAFFING);
    expect(normalizeStaffing({ pizzaCooks: 0, fryerHelpers: 9, sushiChefs: 'abc' })).toEqual(
      DEFAULT_STAFFING
    );
    expect(normalizeStaffing({ pizzaCooks: 3 })).toEqual({ ...DEFAULT_STAFFING, pizzaCooks: 3 });
  });
});

describe('driveMinutesFromKm / roundEtaTo5', () => {
  it('скорости от ресторана: 50 км/ч город, ~85 за городом; 1.5 км ≈ 5 мин, потолок 20', () => {
    expect(driveMinutesFromKm(0.3)).toBe(4);
    // РЕГРЕССИЯ (жалоба ресторана): 1.5 км оценивались в 15-20 мин — реально ≤10.
    expect(driveMinutesFromKm(1.5)).toBe(5);
    expect(driveMinutesFromKm(1.5)).toBeLessThanOrEqual(10);
    expect(driveMinutesFromKm(6)).toBe(9);
    expect(driveMinutesFromKm(16)).toBe(16);
    expect(driveMinutesFromKm(40)).toBe(20);
  });

  it('округление обещания вверх до 5', () => {
    expect(roundEtaTo5(41)).toBe(45);
    expect(roundEtaTo5(45)).toBe(45);
    expect(roundEtaTo5(46)).toBe(50);
  });
});

function makeContext(overrides: Partial<EtaContext['newOrder']> = {}, queue: EtaContext['queue'] = []): EtaContext {
  return {
    nowBerlin: 'Mo., 18:00',
    restaurantAddress: 'Kurhausstr. 11A, 97688 Bad Kissingen',
    staffing: DEFAULT_STAFFING,
    newOrder: {
      orderNumber: '250811001',
      deliveryType: 'delivery',
      address: 'Teststr. 1, 97688 Bad Kissingen',
      items: [],
      units: { pizza: 2, fryer: 0, sushi: 0 },
      prepMinutesEstimate: 16,
      distanceKm: 4,
      driveMinutesEstimate: 11,
      ...overrides,
    },
    queue,
    cooked: [],
  };
}

function queuedOrder(status: string): EtaContext['queue'][number] {
  return {
    orderNumber: 'q',
    status,
    minutesAgo: 5,
    deliveryType: 'delivery',
    units: { pizza: 1, fryer: 0, sushi: 0 },
    itemCount: 1,
  };
}

describe('heuristicEta', () => {
  it('пустая очередь: готовка + дорога + упаковка, округлено до 5', () => {
    const eta = heuristicEta(makeContext());
    // 16 (готовка) + 11 (дорога) + 5 (упаковка) = 32 → 35
    expect(eta.etaMinutes).toBe(35);
    expect(eta.deliveryMinutes).toBe(16);
    expect(eta.loadLevel).toBe('normal');
    expect(eta.advisory).toBeNull();
    expect(eta.source).toBe('heuristic');
  });

  it('самовывоз — без доставки, минимум 15 мин', () => {
    const eta = heuristicEta(
      makeContext({ deliveryType: 'pickup', prepMinutesEstimate: 10, distanceKm: undefined, driveMinutesEstimate: undefined })
    );
    expect(eta.deliveryMinutes).toBe(0);
    expect(eta.etaMinutes).toBe(15);
  });

  it('очередь добавляет зазор 15 мин на заказ и повышает loadLevel', () => {
    const busy = heuristicEta(makeContext({}, [queuedOrder('new'), queuedOrder('preparing'), queuedOrder('new')]));
    // 16 + 3*15 + 16 = 77 → 80
    expect(busy.etaMinutes).toBe(80);
    expect(busy.loadLevel).toBe('busy');

    const peak = heuristicEta(
      makeContext({}, Array.from({ length: 7 }, () => queuedOrder('new')))
    );
    expect(peak.loadLevel).toBe('peak');
    expect(peak.advisory).toMatch(/приостановить приём/);
  });

  it('уже уехавшие заказы (delivering) не считаются очередью кухни', () => {
    const eta = heuristicEta(makeContext({}, [queuedOrder('delivering'), queuedOrder('ready_for_delivery')]));
    expect(eta.etaMinutes).toBe(35);
  });
});

/**
 * Разделение очереди — то, из-за чего гость получал минуты за чужую еду,
 * которая давно готова: в промпт ИИ уезжал ОДИН список, и приготовленный заказ
 * выглядел в нём работой впереди (со станциями и временем готовки).
 */
describe('splitActiveQueue', () => {
  const row = (orderNumber: string, status: string, extra: Record<string, any> = {}) => ({
    _id: orderNumber,
    orderNumber,
    status,
    deliveryType: 'delivery',
    createdAt: new Date('2026-08-18T17:00:00Z'),
    items: [{ name: 'Pizza Margherita', quantity: 2, category: 'Pizza' }],
    ...extra,
  });

  const NOW = new Date('2026-08-18T17:20:00Z').getTime();

  it('на кухне остаются только new и preparing', () => {
    const { queue, cooked } = splitActiveQueue(
      [
        row('001', 'new'),
        row('002', 'preparing'),
        row('003', 'ready_for_delivery'),
        row('004', 'delivering'),
      ],
      { now: NOW }
    );

    expect(queue.map((o) => o.orderNumber)).toEqual(['001', '002']);
    expect(cooked.map((o) => o.orderNumber)).toEqual(['003', '004']);
  });

  it('у приготовленного заказа не показываем станции и время готовки', () => {
    const { cooked } = splitActiveQueue([row('003', 'ready_for_delivery')], { now: NOW });
    // Пицца в заказе есть, но у плиты работы от него больше нет.
    expect(cooked[0]).not.toHaveProperty('units');
    expect(cooked[0]).not.toHaveProperty('itemCount');
    expect(cooked[0].minutesAgo).toBe(20);
  });

  it('сам оцениваемый заказ в свою же очередь не попадает', () => {
    const { queue } = splitActiveQueue([row('001', 'preparing'), row('002', 'new')], {
      excludeId: '001',
      now: NOW,
    });
    expect(queue.map((o) => o.orderNumber)).toEqual(['002']);
  });

  it('остаток обещания считается от etaSetAt, а не от создания', () => {
    const { queue } = splitActiveQueue(
      [row('001', 'preparing', { etaMinutes: 30, etaSetAt: new Date('2026-08-18T17:10:00Z') })],
      { now: NOW }
    );
    // Обещали 30 минут в 17:10, сейчас 17:20 → осталось 20.
    expect(queue[0].promiseRemainingMinutes).toBe(20);
  });

  it('isCookedStatus знает ровно два статуса', () => {
    expect(isCookedStatus('ready_for_delivery')).toBe(true);
    expect(isCookedStatus('delivering')).toBe(true);
    expect(isCookedStatus('preparing')).toBe(false);
    expect(isCookedStatus('new')).toBe(false);
    expect(isCookedStatus(undefined)).toBe(false);
  });
});

describe('normalizeEtaVerdict — самовывоз без доставки', () => {
  const rawVerdict = {
    etaMinutes: 45,
    prepMinutes: 25,
    deliveryMinutes: 20,
    loadLevel: 'normal' as const,
    advisory: null,
    routeHint: null,
    reasoning: 'test',
  };

  it('доставка: время модели проходит как есть (округлено до 5)', () => {
    const verdict = normalizeEtaVerdict(rawVerdict, makeContext());
    expect(verdict.etaMinutes).toBe(45);
    expect(verdict.deliveryMinutes).toBe(20);
    expect(verdict.distanceKm).toBe(4);
  });

  it('самовывоз: минуты доставки вычитаются из обещания, deliveryMinutes = 0', () => {
    const ctx = makeContext({ deliveryType: 'pickup' });
    const verdict = normalizeEtaVerdict(rawVerdict, ctx);
    // 45 - 20 = 25 → только изготовление
    expect(verdict.etaMinutes).toBe(25);
    expect(verdict.deliveryMinutes).toBe(0);
    expect(verdict.distanceKm).toBeUndefined();
    expect(verdict.driveMinutes).toBeUndefined();
  });

  it('самовывоз: обещание не превышает prep-часть, даже если модель завысила', () => {
    const ctx = makeContext({ deliveryType: 'pickup' });
    const verdict = normalizeEtaVerdict(
      { ...rawVerdict, etaMinutes: 60, deliveryMinutes: 0, prepMinutes: 30 },
      ctx
    );
    expect(verdict.etaMinutes).toBe(30);
  });

  it('самовывоз: корректный ответ модели (deliveryMinutes=0) проходит без изменений', () => {
    const ctx = makeContext({ deliveryType: 'pickup' });
    const verdict = normalizeEtaVerdict(
      { ...rawVerdict, etaMinutes: 25, deliveryMinutes: 0, prepMinutes: 25 },
      ctx
    );
    expect(verdict.etaMinutes).toBe(25);
    expect(verdict.deliveryMinutes).toBe(0);
  });

  it('битый ответ модели — бросает (уйдём в эвристику)', () => {
    expect(() =>
      normalizeEtaVerdict({ etaMinutes: NaN } as any, makeContext())
    ).toThrow('Malformed ETA verdict');
  });
});
