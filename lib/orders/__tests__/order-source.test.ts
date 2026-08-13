import { describe, expect, it } from 'vitest';
import {
  isLieferandoOrder,
  ownRevenueQuery,
  LIEFERANDO_SOURCE,
  WEBSITE_SOURCE,
} from '../order-source';

describe('isLieferandoOrder', () => {
  it('распознаёт только заказ из чека Lieferando', () => {
    expect(isLieferandoOrder({ source: LIEFERANDO_SOURCE })).toBe(true);
    expect(isLieferandoOrder({ source: WEBSITE_SOURCE })).toBe(false);
  });

  it('заказ без source считается нашим (старые записи, дефолт колонки)', () => {
    expect(isLieferandoOrder({})).toBe(false);
    expect(isLieferandoOrder({ source: null })).toBe(false);
    expect(isLieferandoOrder(undefined)).toBe(false);
    expect(isLieferandoOrder(null)).toBe(false);
  });
});

describe('ownRevenueQuery', () => {
  it('исключает Lieferando и не затирает остальные условия выборки', () => {
    expect(ownRevenueQuery()).toEqual({ source: { $ne: LIEFERANDO_SOURCE } });

    // Так фильтр применяется в вызывающем коде: спред + свои условия.
    const query = { ...ownRevenueQuery(), status: { $ne: 'pending_payment' } };
    expect(query).toEqual({
      source: { $ne: LIEFERANDO_SOURCE },
      status: { $ne: 'pending_payment' },
    });
  });
});
