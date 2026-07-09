// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildAmountBreakdown, buildPurchaseUnit, minorToValue, toMinorUnits } from '../amount';

const item = (name: string, quantity: number, price: number, totalPrice: number) => ({
  name,
  quantity,
  price,
  totalPrice,
});

describe('toMinorUnits — округление в центы', () => {
  it('обычные суммы', () => {
    expect(toMinorUnits(24.9)).toBe(2490);
    expect(toMinorUnits(0.01)).toBe(1);
    expect(toMinorUnits(0)).toBe(0);
  });

  it('устойчиво к float-артефактам (4.475*100 = 447.49999…)', () => {
    // Полуцентовые значения (BOGO −50% от 8.95) округляются вверх, а не теряют цент.
    expect(toMinorUnits(4.475)).toBe(448);
    expect(toMinorUnits(8.95)).toBe(895);
    // 19.9 + 5 в double = 24.900000000000002
    expect(toMinorUnits(19.9 + 5)).toBe(2490);
  });
});

describe('buildAmountBreakdown — серверный расчёт из позиций заказа', () => {
  it('без скидок: item_total + shipping = total, discount = 0', () => {
    const b = buildAmountBreakdown({
      items: [item('Pizza Salami', 2, 9.95, 19.9), item('Cola', 1, 5, 5)],
      deliveryFee: 2.5,
      total: 27.4,
    });
    expect(b.itemTotalMinor).toBe(2490);
    expect(b.shippingMinor).toBe(250);
    expect(b.discountMinor).toBe(0);
    expect(b.totalMinor).toBe(2740);
    // Инвариант PayPal: breakdown сходится до цента.
    expect(b.itemTotalMinor + b.shippingMinor - b.discountMinor).toBe(b.totalMinor);
  });

  it('скидка (купон/акция/баллы) уходит в discount как остаток', () => {
    const b = buildAmountBreakdown({
      items: [item('Pizza Funghi', 1, 12.5, 12.5)],
      deliveryFee: 0,
      total: 10.0, // сервер списал 2.50 скидки
    });
    expect(b.discountMinor).toBe(250);
    expect(b.itemTotalMinor + b.shippingMinor - b.discountMinor).toBe(b.totalMinor);
  });

  it('количество сохраняется, если цена делится на qty без остатка', () => {
    const b = buildAmountBreakdown({
      items: [item('Pizza Salami', 2, 9.95, 19.9)],
      deliveryFee: 0,
      total: 19.9,
    });
    expect(b.items).toEqual([{ name: 'Pizza Salami', quantity: 2, unitAmountMinor: 995 }]);
  });

  it('неделящаяся строка сворачивается в quantity=1 без потери цента', () => {
    // 2 × 4.475 (BOGO-полцены): unit-центы 448×2=896 ≠ line 895 → одна строка 895.
    const b = buildAmountBreakdown({
      items: [item('Pizza Hawaii', 2, 4.475, 8.95)],
      deliveryFee: 0,
      total: 8.95,
    });
    expect(b.items).toEqual([{ name: '2× Pizza Hawaii', quantity: 1, unitAmountMinor: 895 }]);
    expect(b.itemTotalMinor).toBe(895);
  });

  it('gratis-позиции (0 €) не попадают в items и не ломают сумму', () => {
    const b = buildAmountBreakdown({
      items: [item('Pizza Salami', 1, 9.95, 9.95), item('[GRATIS] Wasser', 1, 0, 0)],
      deliveryFee: 0,
      total: 9.95,
    });
    expect(b.items).toHaveLength(1);
    expect(b.itemTotalMinor).toBe(995);
  });

  it('служебные префиксы [GRATIS]/[AKTION] снимаются с имён для чека PayPal', () => {
    const b = buildAmountBreakdown({
      items: [item('[AKTION] Pizza Tonno', 1, 5.0, 5.0)],
      deliveryFee: 0,
      total: 5.0,
    });
    expect(b.items[0]!.name).toBe('Pizza Tonno');
  });

  it('позиции не покрывают сумму заказа (residual < 0) → ошибка', () => {
    expect(() =>
      buildAmountBreakdown({
        items: [item('Pizza', 1, 5, 5)],
        deliveryFee: 0,
        total: 9.99,
      })
    ).toThrow(/decken die Bestellsumme nicht/);
  });

  it('нулевая/отрицательная сумма заказа → ошибка', () => {
    expect(() =>
      buildAmountBreakdown({ items: [], deliveryFee: 0, total: 0 })
    ).toThrow(/positiv/);
  });
});

describe('buildPurchaseUnit — тело purchase_units[0]', () => {
  it('items суммируются в item_total, суммы в формате "12.34"', () => {
    const breakdown = buildAmountBreakdown({
      items: [item('Pizza Salami', 2, 9.95, 19.9), item('Cola', 1, 5, 5)],
      deliveryFee: 2.5,
      total: 25.4, // 2 € скидки
    });
    const pu = buildPurchaseUnit('order123', breakdown) as any;

    expect(pu.reference_id).toBe('order123');
    expect(pu.custom_id).toBe('order123');
    expect(pu.amount.value).toBe('25.40');
    expect(pu.amount.breakdown.item_total.value).toBe('24.90');
    expect(pu.amount.breakdown.shipping.value).toBe('2.50');
    expect(pu.amount.breakdown.discount.value).toBe('2.00');
    expect(pu.amount.currency_code).toBe('EUR');

    const itemsSum = pu.items.reduce(
      (sum: number, it: any) => sum + toMinorUnits(Number(it.unit_amount.value)) * Number(it.quantity),
      0
    );
    expect(minorToValue(itemsSum)).toBe(pu.amount.breakdown.item_total.value);
  });

  it('discount = 0 не включается в breakdown', () => {
    const breakdown = buildAmountBreakdown({
      items: [item('Cola', 1, 5, 5)],
      deliveryFee: 0,
      total: 5,
    });
    const pu = buildPurchaseUnit('order123', breakdown) as any;
    expect(pu.amount.breakdown.discount).toBeUndefined();
  });
});
