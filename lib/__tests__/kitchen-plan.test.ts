import { describe, expect, it } from 'vitest';
import {
  buildDispatchRules,
  heuristicKitchenPlan,
  normalizeCity,
  normalizeCourierCount,
  normalizePlanVerdict,
  PLAN_TUNING,
  type KitchenPlanContext,
  type PlanOrderContext,
} from '../eta/kitchen-plan';

function order(overrides: Partial<PlanOrderContext>): PlanOrderContext {
  return {
    orderNumber: 'X',
    status: 'new',
    minutesAgo: 5,
    deliveryType: 'delivery',
    items: ['1x Pizza Salami'],
    units: { pizza: 1, fryer: 0, sushi: 0 },
    prepMinutesEstimate: 10,
    ...overrides,
  };
}

function context(orders: PlanOrderContext[], onTheRoad: string[] = []): KitchenPlanContext {
  return {
    nowBerlin: 'Mo., 18:00',
    restaurantAddress: 'Kurhausstr. 11A, 97688 Bad Kissingen',
    courierCount: 1,
    orders,
    onTheRoad,
  };
}

describe('normalizeCourierCount', () => {
  it('целое 1…6 проходит, мусор и вне диапазона → дефолт', () => {
    expect(normalizeCourierCount(2)).toBe(2);
    expect(normalizeCourierCount('3')).toBe(3);
    expect(normalizeCourierCount(0)).toBe(PLAN_TUNING.courierCount);
    expect(normalizeCourierCount(7)).toBe(PLAN_TUNING.courierCount);
    expect(normalizeCourierCount('abc')).toBe(PLAN_TUNING.courierCount);
    expect(normalizeCourierCount(undefined)).toBe(PLAN_TUNING.courierCount);
  });
});

describe('buildDispatchRules', () => {
  it('число курьеров попадает в правила', () => {
    expect(buildDispatchRules(2).join('\n')).toContain('2 courier(s) on shift');
    expect(buildDispatchRules(1).join('\n')).toContain('1 courier(s) on shift');
  });
});

describe('normalizeCity', () => {
  it('регистр и пробелы не влияют на группировку', () => {
    expect(normalizeCity(' Bad  Kissingen ')).toBe('bad kissingen');
    expect(normalizeCity('OERLENBACH')).toBe(normalizeCity('Oerlenbach'));
    expect(normalizeCity(undefined)).toBe('');
  });
});

describe('heuristicKitchenPlan', () => {
  it('заказы одного города — один шаг, готовить вместе, один рейс', () => {
    const plan = heuristicKitchenPlan(
      context([
        order({ orderNumber: '101', city: 'Oerlenbach', distanceKm: 8 }),
        order({ orderNumber: '102', city: 'Oerlenbach', distanceKm: 9 }),
        order({ orderNumber: '103', city: 'Bad Kissingen', distanceKm: 2 }),
      ])
    );

    const oerlenbach = plan.batches.find((b) => b.area === 'Oerlenbach');
    expect(oerlenbach).toBeDefined();
    expect(oerlenbach!.orderNumbers).toEqual(['101', '102']); // от ближнего к дальнему
    expect(oerlenbach!.cookTogether).toBe(true);
    expect(oerlenbach!.courier).toContain('Oerlenbach');

    const bk = plan.batches.find((b) => b.area === 'Bad Kissingen');
    expect(bk!.orderNumbers).toEqual(['103']);
    expect(bk!.cookTogether).toBe(false);
  });

  it('срочный заказ (обещание истекает) идёт первым шагом', () => {
    const plan = heuristicKitchenPlan(
      context([
        order({ orderNumber: '201', city: 'Oerlenbach', promiseRemainingMinutes: 60 }),
        order({ orderNumber: '202', city: 'Bad Bocklet', promiseRemainingMinutes: 5 }),
      ])
    );
    expect(plan.batches[0].orderNumbers).toEqual(['202']);
    expect(plan.batches[0].step).toBe(1);
  });

  it('самовывоз — без курьера, в свой шаг', () => {
    const plan = heuristicKitchenPlan(
      context([
        order({ orderNumber: '301', deliveryType: 'pickup', promiseRemainingMinutes: 10 }),
        order({ orderNumber: '302', city: 'Bad Kissingen', promiseRemainingMinutes: 30 }),
      ])
    );
    const pickup = plan.batches.find((b) => b.area === 'Abholung');
    expect(pickup!.orderNumbers).toEqual(['301']);
    expect(pickup!.courier).toBeNull();
  });

  it('рейс не превышает maxOrdersPerTrip', () => {
    const many = Array.from({ length: PLAN_TUNING.maxOrdersPerTrip + 2 }, (_, i) =>
      order({ orderNumber: `40${i}`, city: 'Bad Kissingen' })
    );
    const plan = heuristicKitchenPlan(context(many));
    for (const b of plan.batches) {
      expect(b.orderNumbers.length).toBeLessThanOrEqual(PLAN_TUNING.maxOrdersPerTrip);
    }
    // Все заказы покрыты ровно один раз.
    const all = plan.batches.flatMap((b) => b.orderNumbers).sort();
    expect(all).toEqual(many.map((o) => o.orderNumber).sort());
  });

  it('пустая очередь — пустой план без advisory', () => {
    const plan = heuristicKitchenPlan(context([], ['901']));
    expect(plan.batches).toEqual([]);
    expect(plan.onTheRoad).toEqual(['901']);
    expect(plan.advisory).toBeNull();
  });

  it('перегруз кухни — loadLevel peak и advisory', () => {
    const many = Array.from({ length: PLAN_TUNING.peakAtOrders }, (_, i) =>
      order({ orderNumber: `50${i}`, city: 'Bad Kissingen' })
    );
    const plan = heuristicKitchenPlan(context(many));
    expect(plan.loadLevel).toBe('peak');
    expect(plan.advisory).toBeTruthy();
  });
});

describe('normalizePlanVerdict', () => {
  const ctx = context([
    order({ orderNumber: '601', city: 'Oerlenbach' }),
    order({ orderNumber: '602', city: 'Oerlenbach' }),
    order({ orderNumber: '603', city: 'Bad Kissingen' }),
  ]);

  it('выдуманные и продублированные заказы выбрасываются, потерянные дописываются', () => {
    const plan = normalizePlanVerdict(
      {
        batches: [
          {
            step: 1,
            orderNumbers: ['601', '602', '999'], // 999 модель выдумала
            area: 'Oerlenbach',
            cookTogether: true,
            courier: 'рейс №1: Oerlenbach',
            rationale: 'один город',
          },
          {
            step: 2,
            orderNumbers: ['601'], // дубль — выбрасывается, шаг схлопывается
            area: 'Oerlenbach',
            cookTogether: false,
            courier: null,
            rationale: '',
          },
          // 603 модель потеряла
        ],
        summary: 'план',
        advisory: null,
        loadLevel: 'busy',
      },
      ctx
    );

    expect(plan.batches).toHaveLength(2);
    expect(plan.batches[0].orderNumbers).toEqual(['601', '602']);
    expect(plan.batches[1].orderNumbers).toEqual(['603']); // дописан автоматически
    expect(plan.batches[1].rationale).toContain('автоматически');
    expect(plan.batches.map((b) => b.step)).toEqual([1, 2]);
    expect(plan.loadLevel).toBe('busy');
    expect(plan.source).toBe('ai');
  });

  it('cookTogether не бывает true для шага из одного заказа', () => {
    const plan = normalizePlanVerdict(
      {
        batches: [
          {
            step: 1,
            orderNumbers: ['601'],
            area: 'Oerlenbach',
            cookTogether: true,
            courier: null,
            rationale: '',
          },
          {
            step: 2,
            orderNumbers: ['602', '603'],
            area: 'Mix',
            cookTogether: true,
            courier: 'рейс',
            rationale: '',
          },
        ],
        summary: '',
        advisory: null,
        loadLevel: 'normal',
      },
      ctx
    );
    expect(plan.batches[0].cookTogether).toBe(false);
    expect(plan.batches[1].cookTogether).toBe(true);
  });

  it('мусор вместо плана — ошибка (уйдём в эвристику)', () => {
    expect(() => normalizePlanVerdict(null, ctx)).toThrow();
    expect(() => normalizePlanVerdict({ batches: 'nope' }, ctx)).toThrow();
  });
});
