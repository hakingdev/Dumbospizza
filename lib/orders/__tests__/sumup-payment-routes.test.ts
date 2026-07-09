// @vitest-environment node
//
// HTTP-слой SumUp-оплаты: вебхук CHECKOUT_STATUS_CHANGED и confirm.
//
// Ключевой инвариант безопасности: ни телу вебхука, ни клиентскому колбэку
// НЕ доверяем — из тела берётся только id checkout'а, состояние всегда
// перепроверяется серверным GET /v0.1/checkouts/{id} (здесь — мок SumUp).
// Клиентский код физически не может создать «Новый» заказ в обход этой
// верификации: промоут случается только при верифицированном PAID.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const finalizeMock = vi.hoisted(() => vi.fn(async () => undefined));
const getSumUpCheckoutMock = vi.hoisted(() => vi.fn());
const orderFindByIdMock = vi.hoisted(() => vi.fn());

vi.mock('../../models', () => ({
  connectToDatabase: vi.fn(async () => undefined),
}));
vi.mock('../../orders/finalize', () => ({
  finalizeOrderPlacement: finalizeMock,
  buildOrderNotification: vi.fn(),
}));
vi.mock('../../models/order.model', () => ({
  Order: { findById: orderFindByIdMock },
}));
vi.mock('../../sumup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../sumup')>();
  return { ...actual, getSumUpCheckout: getSumUpCheckoutMock };
});

import { POST as webhookRoute } from '../../../app/api/payments/sumup/webhook/route';
import { POST as confirmRoute } from '../../../app/api/payments/sumup/confirm/route';
import { SumUpApiError, type SumUpCheckout } from '../../sumup';
import { setPaymentDraftStoreForTests, PENDING_PAYMENT_STATUS } from '../payment-draft';
import { MemoryPaymentDraftStore } from './memory-payment-draft-store';

let store: MemoryPaymentDraftStore;

function post(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

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

beforeEach(() => {
  store = new MemoryPaymentDraftStore();
  setPaymentDraftStoreForTests(store);
  // Order.findById читает из того же in-memory стора — confirm/финализация
  // видят актуальное состояние заказа.
  orderFindByIdMock.mockImplementation(async (id: string) => {
    const row = await store.getOrder(id);
    if (!row) return null;
    return {
      ...row,
      _id: { toString: () => row.id },
      toObject: () => row,
      save: async () => undefined,
    };
  });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  setPaymentDraftStoreForTests(null);
  finalizeMock.mockClear();
  getSumUpCheckoutMock.mockReset();
  orderFindByIdMock.mockReset();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Вебхук CHECKOUT_STATUS_CHANGED
// ---------------------------------------------------------------------------
describe('POST /api/payments/sumup/webhook', () => {
  it('PAID: верифицирует через GET и промоутит драфт → заказ «Новый», финализация один раз', async () => {
    store.seedOrder({ id: 'order1' });
    getSumUpCheckoutMock.mockResolvedValue(sumupCheckout());

    const res = await webhookRoute(
      post('/api/payments/sumup/webhook', {
        id: 'co_1',
        event_type: 'CHECKOUT_STATUS_CHANGED',
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, outcome: 'promoted' });
    expect(getSumUpCheckoutMock).toHaveBeenCalledWith('co_1'); // серверная верификация
    expect(store.visibleOrders()).toHaveLength(1);
    expect(store.visibleOrders()[0].status).toBe('new');
    expect(finalizeMock).toHaveBeenCalledTimes(1);
  });

  it('телу не доверяет: событие «PAID», но GET говорит FAILED → драфт неуспешен, заказа нет', async () => {
    store.seedOrder({ id: 'order1' });
    // Атакующий шлёт «оплачено», реальный статус — FAILED.
    getSumUpCheckoutMock.mockResolvedValue(sumupCheckout({ status: 'FAILED' }));

    const res = await webhookRoute(
      post('/api/payments/sumup/webhook', { id: 'co_1', status: 'PAID', event_type: 'PAID!!' })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: 'marked_failed' });
    expect(store.visibleOrders()).toHaveLength(0);
    expect((await store.getOrder('order1'))?.paymentStatus).toBe('failed');
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it('EXPIRED → 0 заказов', async () => {
    store.seedOrder({ id: 'order1' });
    getSumUpCheckoutMock.mockResolvedValue(sumupCheckout({ status: 'EXPIRED' }));

    const res = await webhookRoute(post('/api/payments/sumup/webhook', { id: 'co_1' }));

    expect(res.status).toBe(200);
    expect(store.visibleOrders()).toHaveLength(0);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it('двойная доставка вебхука → 1 заказ, 1 финализация', async () => {
    store.seedOrder({ id: 'order1' });
    getSumUpCheckoutMock.mockResolvedValue(sumupCheckout());
    const body = { payload: { checkout_id: 'co_1' }, event_type: 'CHECKOUT_STATUS_CHANGED' };

    const first = await webhookRoute(post('/api/payments/sumup/webhook', body));
    const second = await webhookRoute(post('/api/payments/sumup/webhook', body));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ outcome: 'already_paid' });
    expect(store.visibleOrders()).toHaveLength(1);
    expect(store.claimCount).toBe(1);
    expect(finalizeMock).toHaveBeenCalledTimes(1);
  });

  it('мусорное тело без id → 400, состояние не тронуто', async () => {
    store.seedOrder({ id: 'order1' });

    const res = await webhookRoute(post('/api/payments/sumup/webhook', { hello: 'world' }));

    expect(res.status).toBe(400);
    expect(getSumUpCheckoutMock).not.toHaveBeenCalled();
    expect(store.visibleOrders()).toHaveLength(0);
  });

  it('checkout не найден в SumUp (404) → 200 без ретраев, заказа нет', async () => {
    getSumUpCheckoutMock.mockRejectedValue(new SumUpApiError('not found', 404));

    const res = await webhookRoute(post('/api/payments/sumup/webhook', { id: 'co_x' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, handled: false });
  });

  it('временный сбой верификации → 503 (SumUp ретраит), состояние не тронуто', async () => {
    store.seedOrder({ id: 'order1' });
    getSumUpCheckoutMock.mockRejectedValue(new Error('network'));

    const res = await webhookRoute(post('/api/payments/sumup/webhook', { id: 'co_1' }));

    expect(res.status).toBe(503);
    expect((await store.getOrder('order1'))?.paymentStatus).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// Confirm (return/success-колбэк клиента)
// ---------------------------------------------------------------------------
describe('POST /api/payments/sumup/confirm', () => {
  it('PAID: промоутит драфт и возвращает номер заказа', async () => {
    store.seedOrder({ id: 'order1' });
    getSumUpCheckoutMock.mockResolvedValue(sumupCheckout());

    const res = await confirmRoute(
      post('/api/payments/sumup/confirm', { orderId: 'order1', checkoutId: 'co_1' })
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.order.orderNumber).toBeTruthy(); // номер присвоен при промоуте
    expect(store.visibleOrders()).toHaveLength(1);
    expect(finalizeMock).toHaveBeenCalledTimes(1);
  });

  it('колбэк виджета лжёт (checkout PENDING) → 402, заказа нет', async () => {
    store.seedOrder({ id: 'order1' });
    getSumUpCheckoutMock.mockResolvedValue(sumupCheckout({ status: 'PENDING' }));

    const res = await confirmRoute(
      post('/api/payments/sumup/confirm', { orderId: 'order1', checkoutId: 'co_1' })
    );

    expect(res.status).toBe(402);
    expect(store.visibleOrders()).toHaveLength(0);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it('чужой checkout (reference другого заказа) → 402, заказа нет', async () => {
    store.seedOrder({ id: 'order1' });
    store.seedOrder({ id: 'order2' });
    getSumUpCheckoutMock.mockResolvedValue(sumupCheckout({ checkout_reference: 'order2' }));

    const res = await confirmRoute(
      post('/api/payments/sumup/confirm', { orderId: 'order1', checkoutId: 'co_1' })
    );

    expect(res.status).toBe(402);
    expect(store.visibleOrders()).toHaveLength(0);
  });

  it('вебхук успел первым → confirm отвечает alreadyPaid без второй финализации', async () => {
    store.seedOrder({ id: 'order1' });
    getSumUpCheckoutMock.mockResolvedValue(sumupCheckout());

    await webhookRoute(post('/api/payments/sumup/webhook', { id: 'co_1' }));
    finalizeMock.mockClear();

    const res = await confirmRoute(
      post('/api/payments/sumup/confirm', { orderId: 'order1', checkoutId: 'co_1' })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, alreadyPaid: true });
    expect(store.claimCount).toBe(1);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it('регресс: заказ с оплатой при получении confirm не обслуживает (400)', async () => {
    store.seedOrder({ id: 'cash1', paymentMethod: 'cash', status: 'new', orderNumber: 'N1' });

    const res = await confirmRoute(
      post('/api/payments/sumup/confirm', { orderId: 'cash1', checkoutId: 'co_1' })
    );

    expect(res.status).toBe(400);
    expect(getSumUpCheckoutMock).not.toHaveBeenCalled();
  });
});
