import { describe, it, expect } from 'vitest';
import { calculatePromotions, getProductPromotionBadges } from '../engine';
import type { PromotionCartItem } from '../types';

/**
 * € Rabatt auf die GESAMTE Bestellung ab Mindestbestellwert
 * (z. B. ab 30 € Bestellwert → 4 € Rabatt). Spiegelt das bestehende
 * percent_discount + scope 'order' Modell für den festen €-Betrag.
 */

const makeFixedOrder = (over: Record<string, unknown> = {}) =>
  ({
    _id: 'fix-order-1',
    name: '4 € ab 30 €',
    type: 'fixed_discount',
    scope: 'order',
    fixedValue: 4,
    minOrderAmount: 30,
    enabled: true,
    validFrom: new Date('2020-01-01'),
    validTo: new Date('2100-01-01'),
    channel: 'all',
    audience: 'all',
    weekdayScheduleEnabled: false,
    happyHourEnabled: false,
    activeDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    targetProductIds: [],
    targetCategoryIds: [],
    targetItems: [],
    rewardItems: [],
    ...over,
  }) as any;

const cart = (unitPrice: number, quantity = 1): PromotionCartItem[] => [
  { productId: 'p1', name: 'Pizza', quantity, unitPrice },
];

describe('€ Rabatt auf die Bestellung ab Mindestbestellwert', () => {
  it('Bestellwert ≥ Schwelle → fester €-Rabatt greift', () => {
    const res = calculatePromotions(cart(32), [makeFixedOrder()], { channel: 'web' });
    expect(res.orderDiscountTotal).toBe(4);
    expect(res.promotionDiscountTotal).toBe(4);
    expect(res.appliedPromotions).toHaveLength(1);
    expect(res.appliedPromotions[0]).toMatchObject({
      promotionId: 'fix-order-1',
      promotionType: 'fixed_discount',
      savedAmount: 4,
    });
  });

  it('Bestellwert unter Schwelle → kein Rabatt', () => {
    const res = calculatePromotions(cart(25), [makeFixedOrder()], { channel: 'web' });
    expect(res.orderDiscountTotal).toBe(0);
    expect(res.promotionDiscountTotal).toBe(0);
    expect(res.appliedPromotions).toHaveLength(0);
  });

  it('Rabatt wird auf den Warenwert gedeckelt (4 € auf 3-€-Bestellung → 3 €)', () => {
    const res = calculatePromotions(cart(3), [makeFixedOrder({ minOrderAmount: 0 })], {
      channel: 'web',
    });
    expect(res.orderDiscountTotal).toBe(3);
  });

  it('ohne Mindestbestellwert greift der Rabatt immer', () => {
    const res = calculatePromotions(cart(10), [makeFixedOrder({ minOrderAmount: undefined })], {
      channel: 'web',
    });
    expect(res.orderDiscountTotal).toBe(4);
  });

  it('Order-scope Rabatt erzeugt KEINEN Produkt-Badge (nicht auf jeder Karte)', () => {
    const badges = getProductPromotionBadges('p1', 'cat1', [makeFixedOrder()], { channel: 'web' });
    expect(badges).toHaveLength(0);
  });

  it('unterdrückt bei aktivem Coupon (excludeMoneyDiscounts)', () => {
    const res = calculatePromotions(cart(32), [makeFixedOrder()], {
      channel: 'web',
      excludeMoneyDiscounts: true,
    });
    expect(res.orderDiscountTotal).toBe(0);
  });

  it('Rückwärtskompatibel: € Rabatt ohne scope bleibt pro Artikel (produktbezogen)', () => {
    // Alt-Angebot: kein scope gesetzt → weiterhin fester Betrag je Artikel.
    const legacy = makeFixedOrder({
      _id: 'fix-legacy',
      scope: undefined,
      fixedValue: 2,
      minOrderAmount: undefined,
      targetProductIds: ['p1'],
    });
    const res = calculatePromotions(cart(10, 2), [legacy], { channel: 'web' });
    // 2 € je Artikel × 2 Stück = 4 € als Produktrabatt (nicht order-scope)
    expect(res.productDiscountTotal).toBe(4);
    expect(res.orderDiscountTotal).toBe(0);
    // produktbezogene € Rabatte zeigen weiterhin einen Badge
    expect(getProductPromotionBadges('p1', 'cat1', [legacy], { channel: 'web' })).toHaveLength(1);
  });
});
