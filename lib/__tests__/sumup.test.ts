import { describe, it, expect } from 'vitest';
import { isSumUpCheckoutPaid, type SumUpCheckout } from '../sumup';

function checkout(overrides: Partial<SumUpCheckout> = {}): SumUpCheckout {
  return {
    id: 'co_123',
    checkout_reference: '250620001',
    status: 'PAID',
    amount: 24.9,
    currency: 'EUR',
    merchant_code: 'M69PJM91',
    ...overrides,
  };
}

describe('isSumUpCheckoutPaid', () => {
  it('принимает оплату при статусе PAID, совпадении reference и суммы', () => {
    expect(
      isSumUpCheckoutPaid(checkout(), { reference: '250620001', amount: 24.9 })
    ).toBe(true);
  });

  it('допускает расхождение суммы в пределах 1 цента (округления)', () => {
    expect(
      isSumUpCheckoutPaid(checkout({ amount: 24.9 }), { reference: '250620001', amount: 24.901 })
    ).toBe(true);
  });

  it.each<SumUpCheckout['status']>(['PENDING', 'FAILED', 'EXPIRED'])(
    'отклоняет неоплаченный статус %s',
    (status) => {
      expect(
        isSumUpCheckoutPaid(checkout({ status }), { reference: '250620001', amount: 24.9 })
      ).toBe(false);
    }
  );

  it('отклоняет чужой checkout_reference (подмена заказа)', () => {
    expect(
      isSumUpCheckoutPaid(checkout({ checkout_reference: '250620999' }), {
        reference: '250620001',
        amount: 24.9,
      })
    ).toBe(false);
  });

  it('отклоняет недоплату (сумма меньше заказа более чем на цент)', () => {
    expect(
      isSumUpCheckoutPaid(checkout({ amount: 1.0 }), { reference: '250620001', amount: 24.9 })
    ).toBe(false);
  });
});
