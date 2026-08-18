import { describe, it, expect } from 'vitest';
import { buildPrintJob, filterItemsByWorkshops, orderToReceiptOrder } from '../print-job';
import { DEFAULT_POS_PRINT_SETTINGS, normalizePosPrintSettings } from '../settings';
import { renderOpsToPaperLines, PROFILE_SUNMI_V2S } from '../../receipt/escpos';

const dbOrder = {
  _id: 'abc123',
  orderNumber: '260818007',
  createdAt: '2026-08-18T00:20:00',
  deliveryType: 'delivery',
  customerName: 'Nicole Schröder',
  phoneNumber: '+49 157 35984469',
  deliveryAddress: { street: 'Ümpfingstraße', houseNumber: '11B', postalCode: '97720', city: 'Nüdlingen' },
  notes: 'Ohne Zwiebeln',
  total: 54.2,
  deliveryFee: 3,
  paymentMethod: 'cash',
  printSeq: 4,
  items: [
    {
      name: 'Pizza Margherita',
      quantity: 1,
      price: 7.9,
      category: 'Pizza',
      options: [{ group: 'Sauce', name: 'Aioli' }],
    },
    { name: 'Maki Philadelphia', quantity: 2, price: 8.5, category: 'MakiLove', subcategory: 'Philadelphia' },
    { name: 'Cola Zero', quantity: 1, price: 3, category: 'Alkoholfreie Getränke' },
  ],
};

describe('orderToReceiptOrder', () => {
  it('склеивает адрес доставки в одну строку', () => {
    expect(orderToReceiptOrder(dbOrder).address).toBe('Ümpfingstraße 11B, 97720 Nüdlingen');
  });

  it('у самовывоза адреса нет', () => {
    expect(orderToReceiptOrder({ ...dbOrder, deliveryType: 'pickup' }).address).toBeUndefined();
  });

  it('опции позиции превращаются в допы под ней', () => {
    const [pizza] = orderToReceiptOrder(dbOrder).items;
    expect(pizza.customizations).toEqual(['Sauce: Aioli']);
  });
});

describe('filterItemsByWorkshops', () => {
  const items = orderToReceiptOrder(dbOrder).items;

  it('без фильтра проходят все позиции', () => {
    expect(filterItemsByWorkshops(items, null)).toHaveLength(3);
  });

  it('фильтр по цеху оставляет его позиции', () => {
    const names = filterItemsByWorkshops(items, ['sushi']).map((i) => i.name);
    expect(names).toContain('Maki Philadelphia');
    expect(names).not.toContain('Pizza Margherita');
  });

  it('напитки остаются всегда — иначе сборщик решит, что колу забыли', () => {
    const names = filterItemsByWorkshops(items, ['sushi']).map((i) => i.name);
    expect(names).toContain('Cola Zero');
  });
});

describe('buildPrintJob', () => {
  const settings = DEFAULT_POS_PRINT_SETTINGS;

  it('переносит printSeq — иначе подтверждение затрёт Nachdruck', () => {
    const job = buildPrintJob(dbOrder, settings)!;
    expect(job.printSeq).toBe(4);
    expect(job.orderNumber).toBe('260818007');
    expect(job.orderId).toBe('abc123');
  });

  it('параметры начертания берутся из настроек, а не из кода', () => {
    const job = buildPrintJob(
      dbOrder,
      normalizePosPrintSettings({ width: 48, boldBody: true, feedLines: 2, copies: 2 })
    )!;
    expect(job.render).toEqual({ width: 48, boldBody: true, bigAccents: true, feedLines: 2 });
    expect(job.copies).toBe(2);
  });

  it('шапка из настроек попадает в операции', () => {
    const job = buildPrintJob(
      dbOrder,
      normalizePosPrintSettings({ header: { title: 'FILIALE NORD' } })
    )!;
    const paper = renderOpsToPaperLines(job.ops, PROFILE_SUNMI_V2S).join('\n');
    expect(paper).toContain('FILIALE NORD');
    expect(paper).not.toContain('DUMBO SLICE PIZZA');
  });

  it('умляуты доживают до бумаги', () => {
    const job = buildPrintJob(dbOrder, settings)!;
    const paper = renderOpsToPaperLines(job.ops, PROFILE_SUNMI_V2S).join('\n');
    expect(paper).toContain('Schröder');
    expect(paper).toContain('Nüdlingen');
  });

  it('заказ без позиций нужного цеха не порождает задание', () => {
    const onlyPizza = {
      ...dbOrder,
      items: [{ name: 'Pizza Margherita', quantity: 1, price: 7.9, category: 'Pizza' }],
    };
    // Пустой чек, который прибор бы напечатал и подтвердил, — хуже отсутствия задания.
    expect(buildPrintJob(onlyPizza, normalizePosPrintSettings({ workshops: ['sushi'] }))).toBeNull();
  });
});
