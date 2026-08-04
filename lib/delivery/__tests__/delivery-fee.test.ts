import { describe, it, expect } from 'vitest';
import { resolveDeliveryFee, normalizeFreeDeliveryThreshold } from '../delivery-fee';

describe('normalizeFreeDeliveryThreshold', () => {
  it('пусто/мусор/отрицательное → 0 (правило выключено)', () => {
    expect(normalizeFreeDeliveryThreshold(undefined)).toBe(0);
    expect(normalizeFreeDeliveryThreshold(null)).toBe(0);
    expect(normalizeFreeDeliveryThreshold('')).toBe(0);
    expect(normalizeFreeDeliveryThreshold('abc')).toBe(0);
    expect(normalizeFreeDeliveryThreshold(-5)).toBe(0);
  });

  it('читает число и строку с запятой', () => {
    expect(normalizeFreeDeliveryThreshold(30)).toBe(30);
    expect(normalizeFreeDeliveryThreshold('29,5')).toBe(29.5);
  });
});

describe('resolveDeliveryFee', () => {
  it('РЕГРЕССИЯ: без настроенного порога тариф зоны действует на любой сумме', () => {
    // Зона «10-12 km»: Mindestbestellwert 37 €, Lieferkosten 5 €. Захардкоженный
    // порог 30 € делал эти 5 € недостижимыми — заказ, прошедший минималку, всегда
    // был ≥ 30 € → «Kostenlos».
    const fee = resolveDeliveryFee({
      deliveryType: 'delivery',
      merchandiseSubtotal: 37.8,
      zoneDeliveryFee: 5,
    });
    expect(fee).toBe(5);
  });

  it('порог из настроек обнуляет доставку от указанной суммы', () => {
    const input = { deliveryType: 'delivery' as const, zoneDeliveryFee: 5, freeDeliveryThreshold: 50 };
    expect(resolveDeliveryFee({ ...input, merchandiseSubtotal: 49.99 })).toBe(5);
    expect(resolveDeliveryFee({ ...input, merchandiseSubtotal: 50 })).toBe(0);
  });

  it('самовывоз — всегда 0', () => {
    expect(
      resolveDeliveryFee({ deliveryType: 'pickup', merchandiseSubtotal: 10, zoneDeliveryFee: 6 })
    ).toBe(0);
  });

  it('мусорный тариф зоны не ломает сумму', () => {
    expect(
      resolveDeliveryFee({
        deliveryType: 'delivery',
        merchandiseSubtotal: 20,
        zoneDeliveryFee: NaN as unknown as number,
      })
    ).toBe(0);
  });
});
