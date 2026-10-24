import { describe, it, expect } from 'vitest';
import {
  buildMinOrderSurchargeItem,
  computeMinOrderSurcharge,
  isMinOrderSurchargeItem,
  MIN_ORDER_SURCHARGE_NAME,
} from '../min-order-surcharge';

describe('computeMinOrderSurcharge', () => {
  it('разница до минимума, без float-шума', () => {
    expect(computeMinOrderSurcharge(17.4, 18)).toBe(0.6);
    expect(computeMinOrderSurcharge(9.9, 15)).toBe(5.1);
  });

  it('минимум набран или не задан → 0', () => {
    expect(computeMinOrderSurcharge(18, 18)).toBe(0);
    expect(computeMinOrderSurcharge(25, 18)).toBe(0);
    expect(computeMinOrderSurcharge(5, 0)).toBe(0);
    expect(computeMinOrderSurcharge(5, null)).toBe(0);
  });
});

describe('isMinOrderSurchargeItem', () => {
  it('узнаёт строку по kind и по имени без товара (старые записи)', () => {
    expect(isMinOrderSurchargeItem(buildMinOrderSurchargeItem(0.6))).toBe(true);
    expect(isMinOrderSurchargeItem({ product: '', name: MIN_ORDER_SURCHARGE_NAME })).toBe(true);
  });

  it('обычный товар — не доплата', () => {
    expect(isMinOrderSurchargeItem({ product: 'p1', name: 'Bayern Pizza' })).toBe(false);
    expect(isMinOrderSurchargeItem({ product: 'p1', name: MIN_ORDER_SURCHARGE_NAME })).toBe(false);
  });
});
