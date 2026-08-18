import { describe, it, expect } from 'vitest';
import {
  groupItemsByCategory,
  groupItemsBySubcategory,
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

describe('groupItemsBySubcategory', () => {
  it('позиции без метки идут первыми, затем группы в порядке появления', () => {
    const groups = groupItemsBySubcategory([
      { name: 'Philadelphia Lachs', quantity: 1, subcategory: 'Philadelphia' },
      { name: 'Miso Suppe', quantity: 1 },
      { name: 'California Ebi', quantity: 1, subcategory: 'California' },
      { name: 'Philadelphia Avocado', quantity: 1, subcategory: 'Philadelphia' },
    ]);
    expect(groups.map((g) => g.subcategory)).toEqual([null, 'Philadelphia', 'California']);
    expect(groups[1].items.map((i) => i.name)).toEqual([
      'Philadelphia Lachs',
      'Philadelphia Avocado',
    ]);
  });

  it('без меток — одна группа null', () => {
    const groups = groupItemsBySubcategory([{ name: 'A', quantity: 1 }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].subcategory).toBeNull();
  });
});

describe('buildKitchenReceiptOps — подкатегории', () => {
  const sushiOrder: ReceiptOrder = {
    orderId: '2',
    deliveryType: 'pickup',
    totalAmount: 30,
    paymentMethod: 'cash',
    items: [
      { name: 'Miso Suppe', quantity: 1, price: 4, category: 'MakiLove Sushi' },
      {
        name: 'Philadelphia Lachs',
        quantity: 1,
        price: 12,
        category: 'MakiLove Sushi',
        subcategory: 'Philadelphia',
      },
      {
        name: 'California Ebi',
        quantity: 1,
        price: 10,
        category: 'MakiLove Sushi',
        subcategory: 'California',
      },
      { name: 'Margherita', quantity: 1, price: 7.9, category: 'Pizza' },
    ],
  };
  const ops = buildKitchenReceiptOps(sushiOrder);
  const text = renderOpsToText(ops, 42).join('\n');

  it('подкатегория — жирный подзаголовок под категорией', () => {
    const subOp = ops.find((o) => o.type === 'text' && o.text === '* Philadelphia *');
    expect(subOp).toBeTruthy();
    expect((subOp as any).bold).toBe(true);
  });

  it('порядок: категория → без метки → подкатегории со своими товарами', () => {
    const iCat = text.indexOf('MakiLove Sushi');
    const iLoose = text.indexOf('Miso Suppe');
    const iPhilaHdr = text.indexOf('* Philadelphia *');
    const iPhilaItem = text.indexOf('Philadelphia Lachs');
    const iCali = text.indexOf('* California *');
    expect(iCat).toBeGreaterThanOrEqual(0);
    expect(iCat).toBeLessThan(iLoose);
    expect(iLoose).toBeLessThan(iPhilaHdr);
    expect(iPhilaHdr).toBeLessThan(iPhilaItem);
    expect(iPhilaItem).toBeLessThan(iCali);
  });

  it('товары другой категории не попадают под чужие подзаголовки', () => {
    expect(text.indexOf('* California *')).toBeLessThan(text.indexOf('Pizza'));
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

describe('buildKitchenReceiptOps — Aktions-/Gratis-Positionen', () => {
  const orderWithPromos: ReceiptOrder = {
    orderId: '1',
    deliveryType: 'pickup',
    totalAmount: 7.9,
    paymentMethod: 'cash',
    items: [
      { name: 'Margherita', quantity: 1, price: 7.9, category: 'Pizza' },
      { name: '[GRATIS] Cola Zero 0,33l', quantity: 1, price: 0, category: 'Getränke' },
      { name: '[AKTION] Salami', quantity: 1, price: 5, category: 'Pizza' },
    ],
  };
  const text = renderOpsToText(buildKitchenReceiptOps(orderWithPromos), 42).join('\n');

  it('печатает без меток [GRATIS]/[AKTION] — только продукт', () => {
    expect(text).toContain('1x Cola Zero 0,33l');
    expect(text).toContain('1x Salami');
    expect(text).not.toContain('[GRATIS]');
    expect(text).not.toContain('[AKTION]');
  });

  it('показывает цену у каждой позиции (продукт + стоимость)', () => {
    const giftLine = text.split('\n').find((l) => l.includes('Cola Zero 0,33l'));
    const aktionLine = text.split('\n').find((l) => l.includes('Salami'));
    const paidLine = text.split('\n').find((l) => l.includes('Margherita'));
    expect(giftLine).toContain('EUR 0,00');
    expect(aktionLine).toContain('EUR 5,00');
    expect(paidLine).toContain('EUR 7,90');
  });
});

describe('время на чеке', () => {
  const render = (order: Partial<ReceiptOrder>) =>
    renderOpsToText(buildKitchenReceiptOps({ ...sampleOrder, ...order }), 42);

  it('шапка идёт по часам заведения, а не по часам сервера', () => {
    // Заказ 18.08.2026 в 18:10 по Берлину. Сервер на Vercel живёт в UTC — и
    // печатал «16:10», час, в который заведение ещё закрыто.
    const lines = render({ createdAt: '2026-08-18T16:10:00Z' });
    expect(lines.join('\n')).toContain('18.08.2026 18:10');
    expect(lines.join('\n')).not.toContain('16:10');
  });

  it('печатает час, к которому заказ должен быть готов', () => {
    const lines = render({
      desiredDeliveryTime: undefined,
      promisedMs: new Date('2026-08-18T18:30:00Z').getTime(), // 20:30 по Берлину
    });
    expect(lines.join('\n')).toContain('FERTIG 20:30');
  });

  it('расхождение обещания с Wunschzeit печатает обеими строками', () => {
    // Гость просил 20:30, кухня сдвинула на 20:35: на бумаге обязаны быть оба
    // часа, иначе сборщик готовит к одному, а гостю назвали другой.
    const text = render({
      desiredDeliveryTime: '20:30',
      promisedMs: new Date('2026-08-18T18:35:00Z').getTime(),
    }).join('\n');
    expect(text).toContain('FERTIG 20:35');
    expect(text).toContain('Wunsch: 20:30');
  });

  it('совпадающий Wunschzeit не дублируется', () => {
    const text = render({
      desiredDeliveryTime: '20:30',
      promisedMs: new Date('2026-08-18T18:30:00Z').getTime(),
    }).join('\n');
    expect(text).toContain('FERTIG 20:30');
    expect(text).not.toContain('Wunsch: 20:30');
  });

  it('заказ ещё не принят — печатает желаемый час гостя', () => {
    const text = render({ desiredDeliveryTime: '19:45', promisedMs: null }).join('\n');
    expect(text).toContain('WUNSCH 19:45');
  });

  it('без времени вовсе строка не печатается', () => {
    const text = render({ desiredDeliveryTime: undefined, promisedMs: null }).join('\n');
    expect(text).not.toContain('FERTIG');
    expect(text).not.toContain('WUNSCH');
  });
});
