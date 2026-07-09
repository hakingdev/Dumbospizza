// @vitest-environment node
//
// Сценарии ТЗ «заказ появляется в „Заказы“ только после оплаты» (SumUp):
//
//  1. успешная оплата → ровно 1 заказ «Новый» (+номер, +финализация один раз);
//  2. отмена оплаты → 0 заказов;
//  3. закрытие окна (никаких событий) → 0 заказов, TTL-очистка добивает драфт;
//  4. FAILED → 0 заказов;
//  5. EXPIRED → 0 заказов;
//  6. двойной вебхук (и вебхук+confirm параллельно) → 1 заказ, 1 финализация;
//  7. 5 попыток оплаты + 1 успех → ровно 1 заказ;
//  8. наличные/при получении → «Новый» сразу + финализация при создании (регресс).
//
// Гоняется НАСТОЯЩАЯ оркестрация (claimOrderPaidAndPromote,
// applySumUpCheckoutStatus, cleanupStalePaymentDrafts) поверх in-memory стора
// с теми же CAS-семантиками, что и drizzle-реализация.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  PENDING_PAYMENT_STATUS,
  initialOrderPlacementState,
  visibleOrderStatusFilter,
  claimOrderPaidAndPromote,
  applySumUpCheckoutStatus,
  cleanupStalePaymentDrafts,
  extractSumUpCheckoutId,
  isUniqueViolation,
} from '../payment-draft';
import { MemoryPaymentDraftStore, uniqueViolation } from './memory-payment-draft-store';
import type { SumUpCheckout } from '../../sumup';

const noopLog = () => undefined;

function sumupCheckout(overrides: Partial<SumUpCheckout> = {}): SumUpCheckout {
  return {
    id: 'co_1',
    checkout_reference: 'order1',
    status: 'PAID',
    amount: 24.9,
    currency: 'EUR',
    merchant_code: 'M69PJM91',
    ...overrides,
  };
}

let store: MemoryPaymentDraftStore;
let finalized: string[];

function deps(extra: Record<string, unknown> = {}) {
  return {
    store,
    log: noopLog,
    logError: noopLog,
    finalize: async (order: any) => {
      finalized.push(order.id);
    },
    ...extra,
  };
}

beforeEach(() => {
  store = new MemoryPaymentDraftStore();
  finalized = [];
});

// ---------------------------------------------------------------------------
// Стартовое состояние заказа по способу оплаты
// ---------------------------------------------------------------------------
describe('initialOrderPlacementState', () => {
  it('онлайн-оплата → драфт pending_payment, финализация откладывается', () => {
    expect(initialOrderPlacementState('online')).toEqual({
      status: PENDING_PAYMENT_STATUS,
      finalizeImmediately: false,
    });
  });

  it.each(['cash', 'card'])(
    'сценарий 8 (регресс): оплата при получении (%s) → сразу «Новый» + финализация',
    (method) => {
      expect(initialOrderPlacementState(method)).toEqual({
        status: 'new',
        finalizeImmediately: true,
      });
    }
  );
});

// ---------------------------------------------------------------------------
// Фильтр выборок («Заказы», export, кабинет, принт-агент)
// ---------------------------------------------------------------------------
describe('visibleOrderStatusFilter', () => {
  it('без явного статуса исключает драфты', () => {
    expect(visibleOrderStatusFilter()).toEqual({ $ne: PENDING_PAYMENT_STATUS });
    expect(visibleOrderStatusFilter(null)).toEqual({ $ne: PENDING_PAYMENT_STATUS });
  });

  it('явный статус проходит как есть', () => {
    expect(visibleOrderStatusFilter('new')).toBe('new');
  });

  it('драфты не отдаются даже при явном запросе pending_payment', () => {
    const filter = visibleOrderStatusFilter(PENDING_PAYMENT_STATUS);
    expect(filter).not.toBe(PENDING_PAYMENT_STATUS);
    expect(typeof filter).toBe('string'); // матчит несуществующий статус → пусто
  });
});

// ---------------------------------------------------------------------------
// Сценарий 1: успешная оплата → ровно один заказ «Новый»
// ---------------------------------------------------------------------------
describe('успешная оплата (PAID)', () => {
  it('промоутит драфт в «Новый», присваивает номер, финализирует один раз', async () => {
    store.seedOrder({ id: 'order1' });
    expect(store.visibleOrders()).toHaveLength(0); // до оплаты оператор не видит ничего

    const result = await applySumUpCheckoutStatus(sumupCheckout(), deps());

    expect(result.outcome).toBe('promoted');
    const visible = store.visibleOrders();
    expect(visible).toHaveLength(1);
    expect(visible[0].status).toBe('new');
    expect(visible[0].paymentStatus).toBe('completed');
    expect(visible[0].orderNumber).toBeTruthy(); // нумерация — при промоуте
    expect(finalized).toEqual(['order1']); // кухня/Telegram — ровно один раз
    // история статусов: draft → new
    expect((visible[0].statusUpdates as any[]).map((s) => s.status)).toEqual([
      PENDING_PAYMENT_STATUS,
      'new',
    ]);
  });

  it('легаси-заказ (создан до деплоя: сразу new + номер) промоутится без изменений номера', async () => {
    store.seedOrder({
      id: 'legacy1',
      status: 'new',
      orderNumber: '250709001',
      statusUpdates: [{ status: 'new', timestamp: new Date().toISOString() }] as any,
    });

    const result = await applySumUpCheckoutStatus(
      sumupCheckout({ checkout_reference: '250709001' }), // старый reference = orderNumber
      deps()
    );

    expect(result.outcome).toBe('promoted');
    const order = await store.getOrder('legacy1');
    expect(order?.paymentStatus).toBe('completed');
    expect(order?.status).toBe('new');
    expect(order?.orderNumber).toBe('250709001'); // COALESCE: номер не перезаписан
    expect((order?.statusUpdates as any[]).map((s) => s.status)).toEqual(['new']); // без дублей истории
    expect(finalized).toEqual(['legacy1']);
  });

  it('сумма checkout не совпала с заказом → заказ НЕ промоутится (подмена суммы)', async () => {
    store.seedOrder({ id: 'order1', total: 24.9 });

    const result = await applySumUpCheckoutStatus(sumupCheckout({ amount: 1.0 }), deps());

    expect(result.outcome).toBe('amount_mismatch');
    expect(store.visibleOrders()).toHaveLength(0);
    expect(finalized).toHaveLength(0);
  });

  it('ошибка финализации не отменяет промоут (печать доберёт очередь агента)', async () => {
    store.seedOrder({ id: 'order1' });

    const result = await applySumUpCheckoutStatus(
      sumupCheckout(),
      deps({
        finalize: async () => {
          throw new Error('telegram down');
        },
      })
    );

    expect(result.outcome).toBe('promoted');
    expect(store.visibleOrders()).toHaveLength(1);
    expect((await store.getOrder('order1'))?.paymentStatus).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// Сценарии 2–5: отмена / закрытие окна / FAILED / EXPIRED → 0 заказов
// ---------------------------------------------------------------------------
describe('неуспешная оплата → 0 заказов', () => {
  it.each<SumUpCheckout['status']>(['FAILED', 'EXPIRED'])(
    'сценарии 4–5: статус %s помечает драфт неуспешным, заказ не создаётся',
    async (status) => {
      store.seedOrder({ id: 'order1' });

      const result = await applySumUpCheckoutStatus(sumupCheckout({ status }), deps());

      expect(result.outcome).toBe('marked_failed');
      expect(store.visibleOrders()).toHaveLength(0);
      expect((await store.getOrder('order1'))?.paymentStatus).toBe('failed');
      expect((await store.getOrder('order1'))?.status).toBe(PENDING_PAYMENT_STATUS);
      expect(finalized).toHaveLength(0);
    }
  );

  it('сценарий 2 (отмена) / 3 (закрытие окна): без событий оплаты драфт невидим, TTL добивает', async () => {
    const past = new Date(Date.now() - 60 * 60_000); // драфт часовой давности
    store.seedOrder({ id: 'order1', createdAt: past });
    store.seedOrder({ id: 'order2', createdAt: new Date() }); // свежая попытка — не трогаем

    // Отмена/закрытие окна: ни confirm, ни вебхук PAID не пришли — оператор
    // ничего не видит уже сейчас.
    expect(store.visibleOrders()).toHaveLength(0);

    const cleaned = await cleanupStalePaymentDrafts({ store, ttlMinutes: 45, log: noopLog });

    expect(cleaned).toBe(1);
    expect((await store.getOrder('order1'))?.paymentStatus).toBe('failed');
    expect((await store.getOrder('order2'))?.paymentStatus).toBe('pending'); // моложе TTL
    expect(store.visibleOrders()).toHaveLength(0); // заказов так и нет
  });

  it('TTL-очистка не трогает оплаченные и обычные заказы', async () => {
    const past = new Date(Date.now() - 120 * 60_000);
    store.seedOrder({ id: 'paid', createdAt: past, status: 'new', paymentStatus: 'completed', orderNumber: 'N1' });
    store.seedOrder({ id: 'cash', createdAt: past, status: 'new', paymentMethod: 'cash', orderNumber: 'N2' });

    const cleaned = await cleanupStalePaymentDrafts({ store, ttlMinutes: 45, log: noopLog });

    expect(cleaned).toBe(0);
    expect((await store.getOrder('paid'))?.paymentStatus).toBe('completed');
    expect((await store.getOrder('cash'))?.paymentStatus).toBe('pending');
  });

  it('поздний PAID после TTL-очистки всё равно промоутит (деньги списаны)', async () => {
    const past = new Date(Date.now() - 120 * 60_000);
    store.seedOrder({ id: 'order1', createdAt: past });
    await cleanupStalePaymentDrafts({ store, ttlMinutes: 45, log: noopLog });
    expect((await store.getOrder('order1'))?.paymentStatus).toBe('failed');

    const result = await applySumUpCheckoutStatus(sumupCheckout(), deps());

    expect(result.outcome).toBe('promoted');
    expect(store.visibleOrders()).toHaveLength(1);
    expect(finalized).toEqual(['order1']);
  });

  it('поздний FAILED по уже оплаченному заказу не даунгрейдит оплату', async () => {
    store.seedOrder({ id: 'order1' });
    await applySumUpCheckoutStatus(sumupCheckout(), deps());

    const result = await applySumUpCheckoutStatus(sumupCheckout({ status: 'FAILED' }), deps());

    expect(result.outcome).toBe('already_paid');
    expect((await store.getOrder('order1'))?.paymentStatus).toBe('completed');
    expect(store.visibleOrders()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Сценарий 6: дубли вебхука и гонка вебхук/confirm → 1 заказ, 1 финализация
// ---------------------------------------------------------------------------
describe('идемпотентность промоута', () => {
  it('двойной вебхук PAID → 1 заказ, 1 финализация', async () => {
    store.seedOrder({ id: 'order1' });

    const first = await applySumUpCheckoutStatus(sumupCheckout(), deps());
    const second = await applySumUpCheckoutStatus(sumupCheckout(), deps());

    expect(first.outcome).toBe('promoted');
    expect(second.outcome).toBe('already_paid');
    expect(store.visibleOrders()).toHaveLength(1);
    expect(store.claimCount).toBe(1);
    expect(finalized).toEqual(['order1']);
  });

  it('вебхук и confirm одновременно → ровно один победитель CAS', async () => {
    store.seedOrder({ id: 'order1' });

    const [a, b] = await Promise.all([
      applySumUpCheckoutStatus(sumupCheckout(), deps()),
      applySumUpCheckoutStatus(sumupCheckout(), deps()),
    ]);

    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(['already_paid', 'promoted']);
    expect(store.visibleOrders()).toHaveLength(1);
    expect(store.claimCount).toBe(1);
    expect(finalized).toEqual(['order1']);
  });

  it('гонка нумерации: конфликт уникального индекса ретраится со свежим номером', async () => {
    store.seedOrder({ id: 'busy', status: 'new', orderNumber: '250709001', paymentStatus: 'completed' });
    store.seedOrder({ id: 'order1' });
    store.nextNumbers = ['250709001', '250709002']; // первый кандидат занят

    const result = await claimOrderPaidAndPromote('order1', { store, log: noopLog });

    expect(result.claimed).toBe(true);
    expect(result.order?.orderNumber).toBe('250709002');
  });

  it('claimOrderPaidAndPromote: повторный вызов после успеха — alreadyPaid, без второго промоута', async () => {
    store.seedOrder({ id: 'order1' });

    const first = await claimOrderPaidAndPromote('order1', { store, log: noopLog });
    const second = await claimOrderPaidAndPromote('order1', { store, log: noopLog });

    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
    expect(second.alreadyPaid).toBe(true);
    expect(store.claimCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Сценарий 7: пять попыток + один успех → ровно один заказ
// ---------------------------------------------------------------------------
describe('повторные попытки оплаты', () => {
  it('5 драфтов (попыток) + 1 оплаченный → ровно 1 заказ у оператора', async () => {
    for (let i = 1; i <= 5; i++) {
      store.seedOrder({ id: `attempt${i}` });
    }

    // Четыре попытки закончились ничем/ошибкой, одна — оплатой.
    await applySumUpCheckoutStatus(
      sumupCheckout({ id: 'co_2', checkout_reference: 'attempt2', status: 'FAILED' }),
      deps()
    );
    const paid = await applySumUpCheckoutStatus(
      sumupCheckout({ id: 'co_5', checkout_reference: 'attempt5' }),
      deps()
    );

    expect(paid.outcome).toBe('promoted');
    const visible = store.visibleOrders();
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe('attempt5');
    expect(finalized).toEqual(['attempt5']);

    // TTL-очистка добивает брошенные попытки — заказов по-прежнему один.
    for (const o of Array.from(store.orders.values())) {
      if (o.status === PENDING_PAYMENT_STATUS) o.createdAt = new Date(Date.now() - 90 * 60_000);
    }
    await cleanupStalePaymentDrafts({ store, ttlMinutes: 45, log: noopLog });
    expect(store.visibleOrders()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Защита от мусора/подмены на входе вебхука
// ---------------------------------------------------------------------------
describe('applySumUpCheckoutStatus — граничные случаи', () => {
  it('неизвестный checkout_reference → order_not_found, ничего не меняется', async () => {
    store.seedOrder({ id: 'order1' });

    const result = await applySumUpCheckoutStatus(
      sumupCheckout({ checkout_reference: 'someone-else' }),
      deps()
    );

    expect(result.outcome).toBe('order_not_found');
    expect(store.visibleOrders()).toHaveLength(0);
    expect(finalized).toHaveLength(0);
  });

  it('заказ с оплатой при получении не промоутится вебхуком (not_online)', async () => {
    store.seedOrder({ id: 'order1', paymentMethod: 'cash', status: 'new', orderNumber: 'N1' });

    const result = await applySumUpCheckoutStatus(sumupCheckout(), deps());

    expect(result.outcome).toBe('not_online');
    expect((await store.getOrder('order1'))?.paymentStatus).toBe('pending');
  });

  it('PENDING → no-op (решение придёт следующим событием)', async () => {
    store.seedOrder({ id: 'order1' });

    const result = await applySumUpCheckoutStatus(sumupCheckout({ status: 'PENDING' }), deps());

    expect(result.outcome).toBe('pending');
    expect((await store.getOrder('order1'))?.paymentStatus).toBe('pending');
    expect(store.visibleOrders()).toHaveLength(0);
  });
});

describe('extractSumUpCheckoutId (тело вебхука)', () => {
  it.each([
    [{ id: 'co_1' }, 'co_1'],
    [{ checkout_id: 'co_2' }, 'co_2'],
    [{ payload: { checkout_id: 'co_3' } }, 'co_3'],
    [{ payload: { id: 'co_4' }, event_type: 'CHECKOUT_STATUS_CHANGED' }, 'co_4'],
  ])('достаёт id из формы %j', (body, expected) => {
    expect(extractSumUpCheckoutId(body)).toBe(expected);
  });

  it.each([[null], ['garbage'], [{}], [{ id: 42 }], [{ payload: {} }]])(
    'мусорное тело %j → null',
    (body) => {
      expect(extractSumUpCheckoutId(body)).toBeNull();
    }
  );
});

describe('isUniqueViolation', () => {
  it('распознаёт 23505 в т.ч. через cause', () => {
    expect(isUniqueViolation(uniqueViolation())).toBe(true);
    expect(isUniqueViolation({ cause: { code: '23505' } })).toBe(true);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
