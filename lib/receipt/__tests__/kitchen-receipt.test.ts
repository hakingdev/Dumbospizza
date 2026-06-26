import { describe, it, expect } from 'vitest';
import {
  groupItemsByCategory,
  formatPaymentMethod,
  formatEuro,
  buildKitchenReceiptOps,
  renderOpsToText,
  type ReceiptOrder,
} from '../kitchen-receipt';

const sampleOrder: ReceiptOrder = {
  orderId: '260626002',
  createdAt: '2026-06-26T16:13:00',
  deliveryType: 'delivery',
  customerName: 'Nicole Schroeder',
  phoneNumber: '+4915735984469',
  address: 'Ümpfigstraße 11B, 97720 Nüdlingen',
  desiredDeliveryTime: '18:15',
  deliveryFee: 3,
  totalAmount: 42.7,
  paymentMethod: 'online',
  items: [
    { name: 'Margherita', quantity: 1, price: 7.9, category: 'Pizza', customizations: ['Solo ca.20x20'] },
    { name: 'Creamy Mushrooms', quantity: 1, price: 10.9, category: 'Pizza' },
    { name: 'Crispy Garnelen', quantity: 1, price: 11.5, category: 'Crispy Sides' },
    { name: 'Cola Zero 0,33l', quantity: 1, price: 3, category: 'Alkoholfreie Getränke' },
  ],
};

describe('groupItemsByCategory', () => {
  it('группирует по категориям в порядке первого появления', () => {
    const groups = groupItemsByCategory(sampleOrder.items);
    expect(groups.map((g) => g.category)).toEqual(['Pizza', 'Crispy Sides', 'Alkoholfreie Getränke']);
    expect(groups[0].items.map((i) => i.name)).toEqual(['Margherita', 'Creamy Mushrooms']);
  });

  it('товары без категории → Sonstiges', () => {
    const groups = groupItemsByCategory([{ name: '[GRATIS] Cola', quantity: 1 }]);
    expect(groups[0].category).toBe('Sonstiges');
  });

  it('сохраняет несмежные позиции одной категории в одной группе', () => {
    const groups = groupItemsByCategory([
      { name: 'A', quantity: 1, category: 'Pizza' },
      { name: 'B', quantity: 1, category: 'Drinks' },
      { name: 'C', quantity: 1, category: 'Pizza' },
    ]);
    expect(groups.map((g) => g.category)).toEqual(['Pizza', 'Drinks']);
    expect(groups[0].items.map((i) => i.name)).toEqual(['A', 'C']);
  });
});

describe('formatPaymentMethod', () => {
  it('cash → BAR, card → KARTE, online → ONLINE', () => {
    expect(formatPaymentMethod('cash')).toBe('BAR');
    expect(formatPaymentMethod('card')).toBe('KARTE');
    expect(formatPaymentMethod('online')).toContain('ONLINE');
  });
});

describe('formatEuro', () => {
  it('немецкий формат с запятой', () => {
    expect(formatEuro(7.9)).toBe('EUR 7,90');
    expect(formatEuro(0)).toBe('EUR 0,00');
  });
});

describe('buildKitchenReceiptOps + renderOpsToText', () => {
  const ops = buildKitchenReceiptOps(sampleOrder);
  const text = renderOpsToText(ops, 42).join('\n');

  it('категории идут жирными заголовками (ops bold)', () => {
    const catOp = ops.find((o) => o.type === 'text' && o.text === 'Pizza');
    expect(catOp).toBeTruthy();
    expect((catOp as any).bold).toBe(true);
  });

  it('категория печатается выше своих товаров', () => {
    expect(text.indexOf('Pizza')).toBeLessThan(text.indexOf('Margherita'));
    expect(text.indexOf('Crispy Sides')).toBeLessThan(text.indexOf('Crispy Garnelen'));
  });

  it('показывает тип оплаты', () => {
    expect(text).toContain('ZAHLUNG: ONLINE');
  });

  it('показывает тип заказа и сумму', () => {
    expect(text).toContain('LIEFERUNG');
    expect(text).toContain('GESAMT:');
    expect(text).toContain('EUR 42,70');
  });

  it('кастомизации печатаются под товаром', () => {
    expect(text).toContain('   - Solo ca.20x20');
  });

  it('заканчивается cut-операцией', () => {
    expect(ops[ops.length - 1].type).toBe('cut');
  });
});
