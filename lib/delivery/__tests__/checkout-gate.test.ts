import { describe, it, expect } from 'vitest';
import { evaluateDeliveryGate, type DeliveryGateInput } from '../checkout-gate';

function input(over: Partial<DeliveryGateInput> = {}): DeliveryGateInput {
  return {
    deliveryType: 'delivery',
    addressChecked: true,
    canDeliver: true,
    subtotal: 30,
    zoneMinOrderAmount: 15,
    ...over,
  };
}

describe('evaluateDeliveryGate', () => {
  it('pickup всегда разрешён, без проверки зоны', () => {
    const r = evaluateDeliveryGate(input({ deliveryType: 'pickup', addressChecked: false, canDeliver: false }));
    expect(r).toEqual({ allowed: true, reason: 'ok' });
  });

  it('адрес не проверен → заблокировано (address_not_checked)', () => {
    const r = evaluateDeliveryGate(input({ addressChecked: false }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('address_not_checked');
  });

  it('адрес проверен, но вне зоны → outside_zone', () => {
    const r = evaluateDeliveryGate(input({ addressChecked: true, canDeliver: false }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('outside_zone');
  });

  it('в зоне, но сумма ниже минимума → below_min_order + shortfall', () => {
    const r = evaluateDeliveryGate(input({ subtotal: 10, zoneMinOrderAmount: 15 }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('below_min_order');
    expect(r.shortfall).toBe(5);
  });

  it('в зоне и сумма достаточна → ok', () => {
    const r = evaluateDeliveryGate(input({ subtotal: 15, zoneMinOrderAmount: 15 }));
    expect(r).toEqual({ allowed: true, reason: 'ok' });
  });

  it('min order не задан (0/null) → ok при любой сумме', () => {
    expect(evaluateDeliveryGate(input({ zoneMinOrderAmount: null, subtotal: 1 })).allowed).toBe(true);
    expect(evaluateDeliveryGate(input({ zoneMinOrderAmount: 0, subtotal: 1 })).allowed).toBe(true);
  });

  it('AC #5: изменение адреса сбрасывает проверку → снова заблокировано', () => {
    // был валиден…
    expect(evaluateDeliveryGate(input({ addressChecked: true, canDeliver: true })).allowed).toBe(true);
    // …адрес отредактирован → addressChecked=false, canDeliver сброшен
    const afterEdit = evaluateDeliveryGate(input({ addressChecked: false, canDeliver: false }));
    expect(afterEdit.allowed).toBe(false);
    expect(afterEdit.reason).toBe('address_not_checked');
  });

  it('AC #6: изменение корзины ревалидирует min-order (30 → ok, 18 → blocked)', () => {
    const base = { addressChecked: true, canDeliver: true, zoneMinOrderAmount: 25 };
    expect(evaluateDeliveryGate(input({ ...base, subtotal: 30 })).allowed).toBe(true);
    const low = evaluateDeliveryGate(input({ ...base, subtotal: 18 }));
    expect(low.allowed).toBe(false);
    expect(low.reason).toBe('below_min_order');
    expect(low.shortfall).toBe(7);
  });
});
