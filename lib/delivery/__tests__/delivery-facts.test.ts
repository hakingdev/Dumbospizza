import { describe, it, expect } from 'vitest';
import { formatDeliveryTimeRange, summarizeDeliveryZones } from '../delivery-facts';

describe('formatDeliveryTimeRange', () => {
  it('берёт диапазон из настройки магазина в любом написании', () => {
    expect(formatDeliveryTimeRange('30-70')).toBe('30–70');
    expect(formatDeliveryTimeRange('30–70 min')).toBe('30–70');
    expect(formatDeliveryTimeRange('45')).toBe('45');
  });

  it('пусто или мусор → null (обещание не показываем)', () => {
    expect(formatDeliveryTimeRange('')).toBeNull();
    expect(formatDeliveryTimeRange(undefined)).toBeNull();
    expect(formatDeliveryTimeRange('schnell')).toBeNull();
  });
});

describe('summarizeDeliveryZones', () => {
  const zones = [
    { deliveryFee: 0, minOrderAmount: 12, maxDistance: 2, active: true },
    { deliveryFee: 3, minOrderAmount: 18, maxDistance: 4, active: true },
    { deliveryFee: 6, minOrderAmount: 42, maxDistance: 16, active: true },
    { deliveryFee: 0, minOrderAmount: 5, maxDistance: 30, active: false },
  ];

  it('радиус бесплатной доставки, минимальный заказ и плата — только по активным зонам', () => {
    expect(summarizeDeliveryZones(zones)).toEqual({ freeUpToKm: 2, minOrderFrom: 12, paidFeeFrom: 3 });
  });

  it('без бесплатных зон freeUpToKm = null', () => {
    expect(summarizeDeliveryZones(zones.slice(1, 3)).freeUpToKm).toBeNull();
  });
});
