import { describe, it, expect } from 'vitest';
import {
  isOnlinePaymentMethod,
  isWaterOrAlcohol,
  resolveItemVatRate,
  buildOrderTax,
  buildSumUpCheckoutDescription,
  FOOD_VAT_RATE,
  BEVERAGE_VAT_RATE,
  MAX_SUMUP_DESCRIPTION_LENGTH,
} from '../tax';

describe('isOnlinePaymentMethod', () => {
  it.each(['online', 'card online', 'card_online', 'Stripe', 'PayPal', 'sumup', 'apple_pay'])(
    'распознаёт онлайн-оплату: %s',
    (m) => {
      expect(isOnlinePaymentMethod(m)).toBe(true);
    }
  );

  it.each(['cash', 'bar', 'card', 'card at door', 'Barzahlung', '', undefined, null])(
    'НЕ считает онлайн офлайн-оплату: %s',
    (m) => {
      expect(isOnlinePaymentMethod(m as any)).toBe(false);
    }
  );
});

describe('isWaterOrAlcohol / resolveItemVatRate', () => {
  it.each(['Wasser 0.5L', 'Mineralwasser', 'Bier', 'Heineken Beer', 'Rotwein', 'Aperol Spritz', '[GRATIS] Bier'])(
    'вода/алкоголь → 19 %: %s',
    (name) => {
      expect(isWaterOrAlcohol({ name })).toBe(true);
      expect(resolveItemVatRate({ name })).toBe(BEVERAGE_VAT_RATE);
    }
  );

  it.each(['Pizza Margherita', 'Pommes', 'Tiramisu', 'Cola', 'Orangensaft'])(
    'еда и прочие напитки (не вода/алкоголь) → 7 %: %s',
    (name) => {
      expect(isWaterOrAlcohol({ name })).toBe(false);
      expect(resolveItemVatRate({ name })).toBe(FOOD_VAT_RATE);
    }
  );

  it('учитывает категорию при определении', () => {
    expect(resolveItemVatRate({ name: 'Hausmarke 0,5', category: 'Bier vom Fass' })).toBe(
      BEVERAGE_VAT_RATE
    );
  });

  it('явная ставка товара (taxRate) имеет приоритет над ключевыми словами', () => {
    // Сок: по ключевым словам был бы 7 %, но в карточке назначено 19 % → берём 19 %.
    expect(resolveItemVatRate({ name: 'Orangensaft', taxRate: 0.19 })).toBe(0.19);
    // Вода: по ключевым словам 19 %, но в карточке назначено 7 % → берём 7 %.
    expect(resolveItemVatRate({ name: 'Wasser', taxRate: 0.07 })).toBe(0.07);
  });

  it('принимает ставку как в долях (0.19), так и в процентах (19)', () => {
    expect(resolveItemVatRate({ name: 'X', taxRate: 19 })).toBe(0.19);
    expect(resolveItemVatRate({ name: 'X', taxRate: 7 })).toBe(0.07);
  });

  it('невалидная/нулевая ставка → откат к классификации по названию', () => {
    expect(resolveItemVatRate({ name: 'Bier', taxRate: 0 })).toBe(BEVERAGE_VAT_RATE);
    expect(resolveItemVatRate({ name: 'Pizza', taxRate: undefined })).toBe(FOOD_VAT_RATE);
  });
});

describe('buildOrderTax', () => {
  it('офлайн-оплата: применения нет, разбивка пустая (поведение прежнее)', () => {
    const result = buildOrderTax({
      paymentMethod: 'cash',
      items: [{ name: 'Pizza Margherita', quantity: 1, totalPrice: 9.5 }],
    });
    expect(result.applied).toBe(false);
    expect(result.breakdown).toEqual([]);
  });

  it('онлайн с одной едой: только строка 7 %', () => {
    const result = buildOrderTax({
      paymentMethod: 'online',
      items: [{ name: 'Pizza Margherita', quantity: 1, totalPrice: 9.5 }],
    });
    expect(result.applied).toBe(true);
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0].rate).toBe(0.07);
    // Netto/USt извлекаются из Brutto: 9,50 / 1,07
    expect(result.breakdown[0].gross).toBe(9.5);
    expect(result.breakdown[0].net).toBe(8.88);
    expect(result.breakdown[0].vat).toBe(0.62);
  });

  it('онлайн пицца + вода: две строки (7 % и 19 %)', () => {
    const result = buildOrderTax({
      paymentMethod: 'online',
      items: [
        { name: 'Pizza Margherita', quantity: 1, totalPrice: 9.5 },
        { name: 'Wasser 0.5L', quantity: 1, totalPrice: 2.5 },
      ],
    });
    expect(result.applied).toBe(true);
    expect(result.breakdown.map((b) => b.rate)).toEqual([0.07, 0.19]);
    const beverage = result.breakdown.find((b) => b.rate === 0.19)!;
    expect(beverage.gross).toBe(2.5);
    expect(beverage.net).toBe(2.1);
    expect(beverage.vat).toBe(0.4);
  });

  it('онлайн с алкоголем: 19 % только на алкоголь, еда остаётся 7 %', () => {
    const result = buildOrderTax({
      paymentMethod: 'online',
      items: [
        { name: 'Pizza Salami', quantity: 1, totalPrice: 11.0 },
        { name: 'Bier', quantity: 2, totalPrice: 6.0 },
      ],
    });
    const food = result.breakdown.find((b) => b.rate === 0.07)!;
    const alcohol = result.breakdown.find((b) => b.rate === 0.19)!;
    expect(food.gross).toBe(11.0);
    expect(alcohol.gross).toBe(6.0);
    const beerLine = result.lineItems.find((l) => l.name === 'Bier')!;
    expect(beerLine.vatRate).toBe(0.19);
    const pizzaLine = result.lineItems.find((l) => l.name === 'Pizza Salami')!;
    expect(pizzaLine.vatRate).toBe(0.07);
  });

  it('суммы заказа не меняются: сумма Brutto по разбивке = сумме позиций', () => {
    const items = [
      { name: 'Pizza Margherita', quantity: 1, totalPrice: 9.5 },
      { name: 'Wasser', quantity: 1, totalPrice: 2.5 },
      { name: 'Bier', quantity: 1, totalPrice: 3.0 },
    ];
    const result = buildOrderTax({ paymentMethod: 'online', items });
    const grossSum = result.breakdown.reduce((s, b) => s + b.gross, 0);
    expect(grossSum).toBe(15.0);
  });
});

describe('buildSumUpCheckoutDescription', () => {
  it('офлайн / нет позиций → только заголовок (прежнее поведение)', () => {
    expect(
      buildSumUpCheckoutDescription({ orderNumber: '250622001', items: [], paymentMethod: 'online' })
    ).toBe('Dumbo Pizza Bestellung #250622001');
    expect(
      buildSumUpCheckoutDescription({
        orderNumber: '250622001',
        paymentMethod: 'cash',
        items: [{ name: 'Pizza', quantity: 1, totalPrice: 9.5 }],
      })
    ).toBe('Dumbo Pizza Bestellung #250622001');
  });

  it('онлайн → позиции (Artikel) и разбивка налогов в описании', () => {
    const desc = buildSumUpCheckoutDescription({
      orderNumber: '250622001',
      paymentMethod: 'online',
      items: [
        { name: 'Pizza Margherita', quantity: 1, totalPrice: 9.5 },
        { name: 'Wasser 0.5L', quantity: 1, totalPrice: 2.5 },
        { name: 'Bier', quantity: 1, totalPrice: 3.0 },
      ],
    });
    expect(desc).toContain('Artikel:');
    expect(desc).toContain('1x Pizza Margherita | 7% | 9,50€');
    expect(desc).toContain('1x Wasser 0.5L | 19% | 2,50€');
    expect(desc).toContain('1x Bier | 19% | 3,00€');
    expect(desc).toContain('Aufschlüsselung der Steuern:');
    expect(desc).toContain('7%: Netto 8,88 | USt. 0,62 | Brutto 9,50');
    expect(desc).toContain('19%: Netto 4,62 | USt. 0,88 | Brutto 5,50');
    // Лимит SumUp измеряется в БАЙТАХ UTF-8 (€ = 3 байта)
    expect(new TextEncoder().encode(desc).length).toBeLessThanOrEqual(MAX_SUMUP_DESCRIPTION_LENGTH);
  });

  it('большой заказ: укладывается в лимит SumUp и сохраняет разбивку налогов', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      name: `Pizza Spezial Nummer ${i + 1}`,
      quantity: 1,
      totalPrice: 9.9,
    }));
    items.push({ name: 'Bier vom Fass', quantity: 1, totalPrice: 4.5 });
    const desc = buildSumUpCheckoutDescription({
      orderNumber: '250622001',
      paymentMethod: 'online',
      items,
    });
    expect(new TextEncoder().encode(desc).length).toBeLessThanOrEqual(MAX_SUMUP_DESCRIPTION_LENGTH);
    // Разбивка налогов (обязательная часть) присутствует всегда
    expect(desc).toContain('Aufschlüsselung der Steuern:');
    expect(desc).toContain('7%: Netto');
    expect(desc).toContain('19%: Netto');
    // Список позиций обрезан с пометкой об остатке
    expect(desc).toMatch(/\+\d+ weitere Artikel/);
  });
});
