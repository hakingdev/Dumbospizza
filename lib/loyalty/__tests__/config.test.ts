// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LOYALTY_RULES,
  mergeLoyaltyRules,
  resolveTier,
  earnPercentFor,
  computeEarnedPoints,
  computeMaxRedeemablePoints,
} from '../config';

const rules = DEFAULT_LOYALTY_RULES;

describe('resolveTier', () => {
  it('возвращает bronze ниже порога silver', () => {
    expect(resolveTier(0, rules)).toBe('bronze');
    expect(resolveTier(14, rules)).toBe('bronze');
  });
  it('silver с 15 заказов, gold с 30', () => {
    expect(resolveTier(15, rules)).toBe('silver');
    expect(resolveTier(29, rules)).toBe('silver');
    expect(resolveTier(30, rules)).toBe('gold');
    expect(resolveTier(100, rules)).toBe('gold');
  });
});

describe('earnPercentFor', () => {
  it('3% bronze, 5% silver, 7% gold', () => {
    expect(earnPercentFor('bronze', rules)).toBe(0.03);
    expect(earnPercentFor('silver', rules)).toBe(0.05);
    expect(earnPercentFor('gold', rules)).toBe(0.07);
  });
});

describe('computeEarnedPoints', () => {
  it('начисляет 3% от оплаченной суммы (Bronze)', () => {
    // 20 € → 0.60 балла
    expect(computeEarnedPoints({ eligibleAmount: 20, tier: 'bronze', rules })).toBe(0.6);
  });
  it('начисляет по проценту уровня (Gold 7%)', () => {
    expect(computeEarnedPoints({ eligibleAmount: 20, tier: 'gold', rules })).toBe(1.4);
  });
  it('НЕ начисляет на нулевую/отрицательную сумму (часть, оплаченная баллами)', () => {
    expect(computeEarnedPoints({ eligibleAmount: 0, tier: 'bronze', rules })).toBe(0);
    expect(computeEarnedPoints({ eligibleAmount: -5, tier: 'bronze', rules })).toBe(0);
  });
  it('применяет множитель выходного дня', () => {
    const weekendRules = mergeLoyaltyRules({ weekendMultiplier: 2, weekendDays: [6] });
    const saturday = new Date('2026-06-20T12:00:00'); // суббота
    expect(
      computeEarnedPoints({ eligibleAmount: 20, tier: 'bronze', rules: weekendRules, date: saturday })
    ).toBe(1.2); // 20 * 3% * 2
  });
  it('добавляет бонус за первый заказ', () => {
    const r = mergeLoyaltyRules({ firstOrderBonus: 5 });
    expect(
      computeEarnedPoints({ eligibleAmount: 20, tier: 'bronze', rules: r, isFirstOrder: true })
    ).toBe(5.6); // 0.6 (3%) + 5 бонус
  });
});

describe('computeMaxRedeemablePoints (cap 30% + min-order)', () => {
  it('ограничивает 30% суммы заказа', () => {
    // заказ 100 €, баланс 1000 → cap = 30 баллов (30%)
    expect(computeMaxRedeemablePoints(1000, 100, rules)).toBe(30);
  });
  it('ограничивает балансом, если он меньше cap', () => {
    expect(computeMaxRedeemablePoints(10, 100, rules)).toBe(10);
  });
  it('запрещает списание ниже минимальной суммы заказа', () => {
    // minOrderToRedeem = 10 €
    expect(computeMaxRedeemablePoints(1000, 9.99, rules)).toBe(0);
  });
  it('учитывает pointValueEuro при пересчёте cap', () => {
    const r = mergeLoyaltyRules({ pointValueEuro: 0.01 }); // 1 балл = 1 цент
    // заказ 100 € → cap 30 € = 3000 баллов
    expect(computeMaxRedeemablePoints(100000, 100, r)).toBe(3000);
  });
});

describe('mergeLoyaltyRules', () => {
  it('переопределяет проценты, сохраняя дефолты', () => {
    const merged = mergeLoyaltyRules({ earnPercentByTier: { bronze: 0.08 } as any });
    expect(merged.earnPercentByTier.bronze).toBe(0.08);
    expect(merged.earnPercentByTier.gold).toBe(0.07); // дефолт сохранён
    expect(merged.redeemMaxShare).toBe(0.3);
  });
});
