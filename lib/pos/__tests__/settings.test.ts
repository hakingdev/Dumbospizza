import { describe, it, expect } from 'vitest';
import {
  normalizePosPrintSettings,
  DEFAULT_POS_PRINT_SETTINGS,
} from '../settings';
import { buildKitchenReceiptOps, renderOpsToText, type ReceiptOrder } from '../../receipt/kitchen-receipt';

describe('normalizePosPrintSettings', () => {
  it('пустой вход даёт измеренные на приборе значения по умолчанию', () => {
    const s = normalizePosPrintSettings(undefined);
    expect(s.width).toBe(32); // измерено линейкой, не из справочника
    expect(s.feedLines).toBe(4); // ножа у V2s нет
    expect(s.enabled).toBe(true);
  });

  it('мусор в ширине не проходит — иначе разъедется весь чек', () => {
    expect(normalizePosPrintSettings({ width: 'сорок' }).width).toBe(32);
    expect(normalizePosPrintSettings({ width: 5 }).width).toBe(24);
    expect(normalizePosPrintSettings({ width: 999 }).width).toBe(64);
  });

  it('интервал опроса и копии ограничены разумными пределами', () => {
    expect(normalizePosPrintSettings({ pollMs: 10 }).pollMs).toBe(1000);
    expect(normalizePosPrintSettings({ pollMs: 999999 }).pollMs).toBe(60_000);
    expect(normalizePosPrintSettings({ copies: 99 }).copies).toBe(3);
  });

  it('пустой список цехов трактуется как «все» — иначе кухня осталась бы без чеков', () => {
    expect(normalizePosPrintSettings({ workshops: [] }).workshops).toBeNull();
    expect(normalizePosPrintSettings({ workshops: ['sushi'] }).workshops).toEqual(['sushi']);
    // Неизвестные цеха отбрасываются, а не роняют настройки.
    expect(normalizePosPrintSettings({ workshops: ['sushi', 'бургеры'] }).workshops).toEqual(['sushi']);
  });

  it('частичный объект дополняется значениями по умолчанию', () => {
    const s = normalizePosPrintSettings({ header: { title: 'TEST' } });
    expect(s.header.title).toBe('TEST');
    expect(s.header.phone).toBe(DEFAULT_POS_PRINT_SETTINGS.header.phone);
  });
});

describe('шапка чека приходит из настроек', () => {
  const order: ReceiptOrder = {
    orderId: '1',
    deliveryType: 'pickup',
    totalAmount: 5,
    items: [{ name: 'Cola', quantity: 1, price: 5, category: 'Getränke' }],
  };

  it('переопределение шапки и подвала попадает на чек', () => {
    const text = renderOpsToText(
      buildKitchenReceiptOps(order, {
        header: { title: 'FILIALE NORD', address: 'Musterweg 1', phone: 'Tel: 000' },
        footer: 'Danke!',
      }),
      32
    ).join('\n');

    expect(text).toContain('FILIALE NORD');
    expect(text).toContain('Musterweg 1');
    expect(text).toContain('Danke!');
    expect(text).not.toContain('DUMBO SLICE PIZZA');
  });

  it('без настроек печатается прежняя шапка — вызовы без chrome не сломаны', () => {
    const text = renderOpsToText(buildKitchenReceiptOps(order), 32).join('\n');
    expect(text).toContain('DUMBO SLICE PIZZA');
    expect(text).toContain('+49 163 2165979');
  });

  it('пустая строка убирает элемент, а не печатает пустую строку', () => {
    const text = renderOpsToText(
      buildKitchenReceiptOps(order, { header: { address: '' }, footer: '' }),
      32
    ).join('\n');
    expect(text).not.toContain('Kurhausstr');
    expect(text).not.toContain('Kein Kassenbon');
  });
});
