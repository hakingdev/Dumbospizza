import { describe, it, expect } from 'vitest';
import {
  berlinDayKey,
  countByStatus,
  orderChannel,
  orderDueMs,
  posDisplayStatus,
  posEuro,
  summarizeItems,
  toBoardOrder,
  toBoardStatus,
  toOrderStatus,
  type PosBoardOrder,
} from '../board';

describe('статусы', () => {
  it('переводит статусы базы в статусы терминала', () => {
    expect(toBoardStatus('ready_for_delivery')).toBe('ready');
    expect(toBoardStatus('completed')).toBe('delivered');
  });

  it('прячет то, чего кухня видеть не должна', () => {
    // Драфт оплаты — ещё не заказ: карточка с ним показала бы кухне работу,
    // которую никто не оплатил.
    expect(toBoardStatus('pending_payment')).toBeNull();
    expect(toBoardStatus(undefined)).toBeNull();
  });

  it('ходит в обе стороны без потерь', () => {
    for (const status of ['new', 'preparing', 'ready', 'delivering', 'delivered', 'cancelled'] as const) {
      expect(toBoardStatus(toOrderStatus(status))).toBe(status);
    }
  });
});

describe('обещанное время', () => {
  const setAt = new Date('2026-08-18T17:00:00Z');

  it('считает срок от момента, когда обещание поставили', () => {
    expect(orderDueMs({ etaMinutes: 30, etaSetAt: setAt })).toBe(setAt.getTime() + 30 * 60_000);
  });

  it('без etaSetAt считает от создания заказа', () => {
    expect(orderDueMs({ etaMinutes: 20, createdAt: setAt })).toBe(setAt.getTime() + 20 * 60_000);
  });

  it('без обещания срока нет', () => {
    expect(orderDueMs({ createdAt: setAt })).toBeNull();
    expect(orderDueMs({ etaMinutes: 30 })).toBeNull();
  });
});

describe('состав и деньги', () => {
  it('сворачивает длинный состав, а не обрезает молча', () => {
    const items = [
      { name: 'Pizza Margherita', quantity: 2 },
      { name: 'Pommes', quantity: 1 },
      { name: 'Cola', quantity: 1 },
      { name: 'Tiramisu', quantity: 3 },
      { name: 'Wasser', quantity: 1 },
    ];
    expect(summarizeItems(items)).toBe(
      '2× Pizza Margherita · 1× Pommes · 1× Cola · +2 weitere'
    );
  });

  it('короткий состав перечисляет целиком', () => {
    expect(summarizeItems([{ name: 'Cola', quantity: 1 }])).toBe('1× Cola');
  });

  it('форматирует деньги по-немецки', () => {
    expect(posEuro(24.8)).toBe('24,80 €');
    expect(posEuro(undefined)).toBe('0,00 €');
  });
});

describe('канал заказа', () => {
  it('различает Lieferando, сайт и телефон', () => {
    expect(orderChannel({ source: 'lieferando' })).toBe('Lieferando');
    expect(orderChannel({ source: 'website' })).toBe('Website');
    // Заказ без источника завели вручную — это телефонный звонок.
    expect(orderChannel({})).toBe('Telefon');
  });
});

describe('день в Берлине', () => {
  it('берёт календарный день заведения, а не UTC', () => {
    // 22:30 UTC 17 августа — это уже 18-е в Берлине (лето, UTC+2).
    expect(berlinDayKey('2026-08-17T22:30:00Z')).toBe('2026-08-18');
  });

  it('мусор не превращает в сегодня', () => {
    expect(berlinDayKey('не дата')).toBe('');
  });
});

describe('строка ленты', () => {
  const order = {
    _id: 'abc',
    orderNumber: '1042',
    status: 'preparing',
    deliveryType: 'delivery',
    deliveryAddress: { street: 'Musterstr.', houseNumber: '12', postalCode: '97688', city: 'Bad Kissingen' },
    customerName: 'Max Mustermann',
    items: [{ name: 'Pizza Margherita', quantity: 2 }],
    total: 24.8,
    paymentMethod: 'online',
    paymentStatus: 'completed',
    etaMinutes: 30,
    etaSetAt: '2026-08-18T17:00:00Z',
    createdAt: '2026-08-18T16:47:00Z',
    statusUpdates: [
      { status: 'new', timestamp: '2026-08-18T16:47:00Z' },
      { status: 'preparing', timestamp: '2026-08-18T17:00:00Z' },
    ],
  };

  it('собирает карточку из заказа', () => {
    const row = toBoardOrder(order)!;
    expect(row.number).toBe('1042');
    expect(row.status).toBe('preparing');
    expect(row.address).toBe('Musterstr. 12, 97688 Bad Kissingen');
    expect(row.total).toBe('24,80 €');
    expect(row.paid).toBe(true);
    expect(row.closedMs).toBe(new Date('2026-08-18T17:00:00Z').getTime());
  });

  it('неоплаченный онлайн-заказ не считает оплаченным', () => {
    const row = toBoardOrder({ ...order, paymentStatus: 'pending' })!;
    expect(row.paid).toBe(false);
  });

  it('наличные считает оплачиваемыми на месте, а не долгом', () => {
    const row = toBoardOrder({ ...order, paymentMethod: 'cash', paymentStatus: 'pending' })!;
    expect(row.paid).toBe(true);
  });

  it('невидимый заказ не попадает в ленту', () => {
    expect(toBoardOrder({ ...order, status: 'pending_payment' })).toBeNull();
  });
});

describe('экранный статус', () => {
  it('готовая доставка = «в пути»: её уже увёз курьер', () => {
    // Кнопка «🚚 Доставка» в Telegram ставит ready_for_delivery, карточка
    // уезжает в тему доставки, гость получает «ist unterwegs» — терминал
    // обязан говорить то же самое.
    expect(posDisplayStatus({ status: 'ready', deliveryType: 'delivery' })).toBe('delivering');
  });

  it('готовый самовывоз остаётся готовым: «unterwegs» у него не бывает', () => {
    expect(posDisplayStatus({ status: 'ready', deliveryType: 'pickup' })).toBe('ready');
  });

  it('остальные статусы не трогает', () => {
    for (const status of ['new', 'preparing', 'delivering', 'delivered', 'cancelled'] as const) {
      expect(posDisplayStatus({ status, deliveryType: 'delivery' })).toBe(status);
      expect(posDisplayStatus({ status, deliveryType: 'pickup' })).toBe(status);
    }
  });
});

describe('счётчики вкладок', () => {
  it('считает по статусам и не забывает пустые', () => {
    const rows = [
      { status: 'preparing' },
      { status: 'preparing' },
      { status: 'delivered' },
    ] as PosBoardOrder[];
    expect(countByStatus(rows)).toEqual({
      new: 0,
      preparing: 2,
      ready: 0,
      delivering: 0,
      delivered: 1,
      cancelled: 0,
    });
  });

  it('готовую доставку кладёт в «Unterwegs», а самовывоз — нет', () => {
    // Иначе над лентой с уехавшими заказами стоит «Unterwegs 0».
    const rows = [
      { status: 'ready', deliveryType: 'delivery' },
      { status: 'ready', deliveryType: 'pickup' },
    ] as PosBoardOrder[];
    const counts = countByStatus(rows);
    expect(counts.delivering).toBe(1);
    expect(counts.ready).toBe(1);
  });
});
