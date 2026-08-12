import { describe, expect, it } from 'vitest';
import {
  buildOrderPayloadFromReceipt,
  lieferandoOrderNumber,
  type LieferandoReceipt,
} from '../lieferando/receipt-import';

/** Полный распознанный чек доставки (типичный Bestellbon). */
function receipt(overrides: Partial<LieferandoReceipt> = {}): LieferandoReceipt {
  return {
    isReceipt: true,
    orderCode: '5X7ABC',
    customerName: 'Max Mustermann',
    phone: '0176 1234567',
    deliveryType: 'delivery',
    address: { street: 'Kurhausstr.', houseNumber: '30', postalCode: '97688', city: 'Bad Kissingen' },
    desiredTime: null,
    items: [
      { quantity: 2, name: 'Pizza Salami', details: '30cm, extra Käse', totalPrice: 21.0 },
      { quantity: 1, name: 'Cola 1L', details: null, totalPrice: 3.5 },
    ],
    total: 24.5,
    paid: true,
    customerNote: 'Bitte klingeln',
    ...overrides,
  };
}

describe('lieferandoOrderNumber', () => {
  it('код чека нормализуется: верхний регистр, только A-Z/0-9/дефис, префикс L-', () => {
    expect(lieferandoOrderNumber('5x7abc')).toBe('L-5X7ABC');
    expect(lieferandoOrderNumber(' #5x7-ab c ')).toBe('L-5X7-ABC');
  });

  it('без кода — детерминированный суррогат от даты/времени', () => {
    const now = new Date('2026-08-12T18:05:09');
    expect(lieferandoOrderNumber(null, now)).toBe('L-260812180509');
    expect(lieferandoOrderNumber('', now)).toBe('L-260812180509');
  });
});

describe('buildOrderPayloadFromReceipt', () => {
  it('полный чек доставки → заказ source=lieferando без печати', () => {
    const p = buildOrderPayloadFromReceipt(receipt());

    expect(p.orderNumber).toBe('L-5X7ABC');
    expect(p.source).toBe('lieferando');
    expect(p.customerName).toBe('Max Mustermann');
    expect(p.phoneNumber).toBe('0176 1234567');
    expect(p.deliveryType).toBe('delivery');
    expect(p.deliveryAddress).toEqual({
      street: 'Kurhausstr.',
      houseNumber: '30',
      postalCode: '97688',
      city: 'Bad Kissingen',
    });
    expect(p.total).toBe(24.5);
    expect(p.subtotal).toBe(24.5);
    expect(p.status).toBe('new');
    // Чек уже напечатан принтером Lieferando — принт-агент не должен его брать.
    expect(p.kitchenPrintStatus).toBe('completed');
    expect(p.customerPrintStatus).toBe('completed');
    expect(p.notes).toContain('Lieferando #5X7ABC');
    expect(p.notes).toContain('online bezahlt');
    expect(p.notes).toContain('Bitte klingeln');
  });

  it('позиции: опции в имени, цена за штуку из суммы строки', () => {
    const p = buildOrderPayloadFromReceipt(receipt());
    expect(p.items).toHaveLength(2);
    expect(p.items[0]).toEqual({
      product: 'lieferando',
      name: 'Pizza Salami (30cm, extra Käse)',
      quantity: 2,
      price: 10.5,
      totalPrice: 21.0,
    });
    expect(p.items[1].name).toBe('Cola 1L');
  });

  it('онлайн оплачен → online/completed; Barzahlung → cash/pending', () => {
    const paidOnline = buildOrderPayloadFromReceipt(receipt({ paid: true }));
    expect(paidOnline.paymentMethod).toBe('online');
    expect(paidOnline.paymentStatus).toBe('completed');

    const cash = buildOrderPayloadFromReceipt(receipt({ paid: false }));
    expect(cash.paymentMethod).toBe('cash');
    expect(cash.paymentStatus).toBe('pending');
    expect(cash.notes).toContain('Barzahlung');
  });

  it('самовывоз — без адреса доставки', () => {
    const p = buildOrderPayloadFromReceipt(receipt({ deliveryType: 'pickup' }));
    expect(p.deliveryType).toBe('pickup');
    expect(p.deliveryAddress).toBeUndefined();
  });

  it('нераспознанные поля не валят импорт: дефолты и сумма из позиций', () => {
    const p = buildOrderPayloadFromReceipt(
      receipt({ customerName: null, phone: null, total: null, customerNote: null })
    );
    expect(p.customerName).toBe('Lieferando-Gast');
    expect(p.phoneNumber).toBe('');
    // total нет на чеке → сумма строк: 21.0 + 3.5
    expect(p.total).toBe(24.5);
  });

  it('Wunschzeit попадает в desiredDeliveryTime', () => {
    const p = buildOrderPayloadFromReceipt(receipt({ desiredTime: '19:30' }));
    expect(p.desiredDeliveryTime).toBe('19:30');
  });

  it('пустые/безымянные строки выбрасываются', () => {
    const p = buildOrderPayloadFromReceipt(
      receipt({
        items: [
          { quantity: 1, name: '  ', details: null, totalPrice: 5 },
          { quantity: 0, name: 'Pizza Funghi', details: null, totalPrice: null },
        ],
      })
    );
    expect(p.items).toHaveLength(1);
    // quantity < 1 поднимается до 1, нечитаемая цена → 0.
    expect(p.items[0]).toEqual({
      product: 'lieferando',
      name: 'Pizza Funghi',
      quantity: 1,
      price: 0,
      totalPrice: 0,
    });
  });
});
