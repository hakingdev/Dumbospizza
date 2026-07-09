// @vitest-environment node
//
// Поведенческие тесты сервисного слоя PayPal (ТЗ §10, интеграционные):
// PayPal API замокан через fetch, БД — in-memory store с теми же
// CAS/lock-семантиками, что и Postgres-реализация. Гоняется НАСТОЯЩАЯ логика
// create/capture/webhook/refund, включая гонки и идемпотентность.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  capturePayPalOrder,
  createPayPalOrderForOrder,
  paypalRequestId,
  processPayPalWebhookEvent,
  refundPayPalPayment,
} from '../service';
import { resetPayPalConfigForTests } from '../config';
import { resetPayPalTokenCacheForTests } from '../client';
import { MemoryPayPalStore } from './memory-store';
import {
  installPayPalFetchMock,
  paypalIssueBody,
  stubPayPalEnv,
  type PayPalFetchMock,
} from './paypal-fetch-mock';

const ORDER_ID = 'order1';
const PP_ORDER = 'PP-1';
const CAPTURE_ID = 'CAP-1';

function seedStore(): MemoryPayPalStore {
  const store = new MemoryPayPalStore();
  store.seedOrder({
    id: ORDER_ID,
    paymentMethod: 'online',
    paymentStatus: 'pending',
    deliveryFee: 0,
    total: 24.9,
    items: [
      { product: 'p1', name: 'Pizza Salami', quantity: 2, price: 9.95, totalPrice: 19.9 },
      { product: 'p2', name: 'Cola', quantity: 1, price: 5, totalPrice: 5 },
    ] as any,
  });
  return store;
}

async function seedCreatedPayment(store: MemoryPayPalStore) {
  return store.insertPaymentCreated({
    orderId: ORDER_ID,
    provider: 'paypal',
    providerOrderId: PP_ORDER,
    status: 'created',
    amountMinor: 2490,
    currency: 'EUR',
  });
}

function completedCaptureBody(value = '24.90', currency = 'EUR') {
  return {
    id: PP_ORDER,
    status: 'COMPLETED',
    purchase_units: [
      {
        payments: {
          captures: [
            { id: CAPTURE_ID, status: 'COMPLETED', amount: { value, currency_code: currency } },
          ],
        },
      },
    ],
  };
}

function captureCompletedEvent(eventId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: eventId,
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {
      id: CAPTURE_ID,
      status: 'COMPLETED',
      amount: { value: '24.90', currency_code: 'EUR' },
      custom_id: ORDER_ID,
      supplementary_data: { related_ids: { order_id: PP_ORDER } },
      ...overrides,
    },
  };
}

describe('PayPal service', () => {
  let mock: PayPalFetchMock;
  let store: MemoryPayPalStore;

  beforeEach(() => {
    stubPayPalEnv();
    resetPayPalConfigForTests();
    resetPayPalTokenCacheForTests();
    mock = installPayPalFetchMock();
    store = seedStore();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------
  // Create order
  // -------------------------------------------------------------------

  describe('createPayPalOrderForOrder', () => {
    it('happy path: сумма из позиций заказа, платёж created, детерминированный Request-Id', async () => {
      mock.route('/v2/checkout/orders', () => ({ status: 201, json: { id: PP_ORDER } }));

      const result = await createPayPalOrderForOrder(ORDER_ID, store);
      expect(result).toMatchObject({ ok: true, paypalOrderId: PP_ORDER, reused: false });

      const call = mock.callsTo('/v2/checkout/orders')[0]!;
      const body = call.json as any;
      expect(body.intent).toBe('CAPTURE');
      expect(body.purchase_units[0].amount.value).toBe('24.90');
      expect(body.purchase_units[0].amount.breakdown.item_total.value).toBe('24.90');
      expect(body.purchase_units[0].reference_id).toBe(ORDER_ID);
      // Идемпотентность PayPal: uuid v5 от order id — при ретрае тот же.
      expect(call.headers['paypal-request-id']).toBe(paypalRequestId('create', ORDER_ID));

      const payment = await store.findPaymentByProviderOrderId('paypal', PP_ORDER);
      expect(payment).toMatchObject({ status: 'created', amountMinor: 2490, currency: 'EUR' });
    });

    it('повторный вызов переиспользует created-платёж с той же суммой (без второго PayPal Order)', async () => {
      mock.route('/v2/checkout/orders', () => ({ status: 201, json: { id: PP_ORDER } }));

      const first = await createPayPalOrderForOrder(ORDER_ID, store);
      const second = await createPayPalOrderForOrder(ORDER_ID, store);

      expect(first.ok && second.ok).toBe(true);
      expect((second as any).paypalOrderId).toBe(PP_ORDER);
      expect((second as any).reused).toBe(true);
      expect(mock.callsTo('/v2/checkout/orders').filter((c) => c.method === 'POST')).toHaveLength(1);
      expect((await store.listPaymentsByOrder(ORDER_ID)).length).toBe(1);
    });

    it('оплаченный заказ → already_paid, платёж не создаётся', async () => {
      await store.claimOrderPaid(ORDER_ID);
      const result = await createPayPalOrderForOrder(ORDER_ID, store);
      expect(result).toMatchObject({ ok: false, code: 'already_paid' });
      expect(mock.callsTo('/v2/checkout/orders')).toHaveLength(0);
    });

    it('не-online заказ → not_online', async () => {
      store.seedOrder({ id: 'cashOrder', paymentMethod: 'cash', total: 10, items: [] as any });
      const result = await createPayPalOrderForOrder('cashOrder', store);
      expect(result).toMatchObject({ ok: false, code: 'not_online' });
    });
  });

  // -------------------------------------------------------------------
  // Capture
  // -------------------------------------------------------------------

  describe('capturePayPalOrder', () => {
    it('COMPLETED → платёж captured, заказ paid, финализация ровно у этого вызова', async () => {
      await seedCreatedPayment(store);
      mock.route(`/v2/checkout/orders/${PP_ORDER}/capture`, () => ({
        status: 201,
        json: completedCaptureBody(),
      }));

      const result = await capturePayPalOrder(PP_ORDER, store);
      expect(result).toMatchObject({
        ok: true,
        orderId: ORDER_ID,
        paymentStatus: 'captured',
        shouldFinalize: true,
      });

      const payment = await store.findPaymentByProviderOrderId('paypal', PP_ORDER);
      expect(payment!.providerCaptureId).toBe(CAPTURE_ID);
      expect((await store.getOrderById(ORDER_ID))!.paymentStatus).toBe('completed');
      expect(store.claimCount).toBe(1);

      const call = mock.callsTo('/capture')[0]!;
      expect(call.headers['paypal-request-id']).toBe(paypalRequestId('capture', PP_ORDER));
    });

    it('capture дважды → ровно один paid, второй ответ идемпотентный без внешнего вызова', async () => {
      await seedCreatedPayment(store);
      mock.route(`/v2/checkout/orders/${PP_ORDER}/capture`, () => ({
        status: 201,
        json: completedCaptureBody(),
      }));

      const first = await capturePayPalOrder(PP_ORDER, store);
      const second = await capturePayPalOrder(PP_ORDER, store);

      expect((first as any).shouldFinalize).toBe(true);
      expect(second).toMatchObject({ ok: true, alreadyCaptured: true, shouldFinalize: false });
      expect(store.claimCount).toBe(1);
      // Второй вызов не ходил в PayPal (идемпотентность до внешнего вызова).
      expect(mock.callsTo('/capture')).toHaveLength(1);
    });

    it('одновременные capture (гонка) → финализация ровно одна', async () => {
      await seedCreatedPayment(store);
      mock.route(`/v2/checkout/orders/${PP_ORDER}/capture`, () => ({
        status: 201,
        json: completedCaptureBody(),
      }));

      const [a, b] = await Promise.all([
        capturePayPalOrder(PP_ORDER, store),
        capturePayPalOrder(PP_ORDER, store),
      ]);

      const finalized = [(a as any).shouldFinalize, (b as any).shouldFinalize].filter(Boolean);
      expect(finalized).toHaveLength(1);
      expect(store.claimCount).toBe(1);
      expect((await store.getOrderById(ORDER_ID))!.paymentStatus).toBe('completed');
    });

    it('вебхук пришёл раньше ответа capture → нет двойного paid', async () => {
      await seedCreatedPayment(store);

      // 1. Вебхук успел первым: платёж captured, заказ paid, финализация у вебхука.
      const webhookOutcome = await processPayPalWebhookEvent(
        captureCompletedEvent('WH-1') as any,
        store
      );
      expect(webhookOutcome.finalizeOrderId).toBe(ORDER_ID);
      expect(store.claimCount).toBe(1);

      // 2. Теперь отвечает capture-роут: платёж уже captured → идемпотентный
      //    ответ, второй финализации НЕТ, внешний вызов не делается.
      const result = await capturePayPalOrder(PP_ORDER, store);
      expect(result).toMatchObject({ ok: true, alreadyCaptured: true, shouldFinalize: false });
      expect(store.claimCount).toBe(1);
      expect(mock.callsTo('/capture')).toHaveLength(0);
    });

    it('INSTRUMENT_DECLINED → restart, состояние не меняется', async () => {
      await seedCreatedPayment(store);
      mock.route(`/v2/checkout/orders/${PP_ORDER}/capture`, () => ({
        status: 422,
        json: paypalIssueBody('INSTRUMENT_DECLINED'),
      }));

      const result = await capturePayPalOrder(PP_ORDER, store);
      expect(result).toMatchObject({ ok: false, code: 'restart' });
      expect((await store.findPaymentByProviderOrderId('paypal', PP_ORDER))!.status).toBe('created');
      expect((await store.getOrderById(ORDER_ID))!.paymentStatus).toBe('pending');
    });

    it('ORDER_ALREADY_CAPTURED → синхронизация через GET, заказ paid', async () => {
      await seedCreatedPayment(store);
      mock.route(`/v2/checkout/orders/${PP_ORDER}/capture`, () => ({
        status: 422,
        json: paypalIssueBody('ORDER_ALREADY_CAPTURED'),
      }));
      mock.route(`/v2/checkout/orders/${PP_ORDER}`, (call) =>
        call.method === 'GET' ? { json: completedCaptureBody() } : undefined
      );

      const result = await capturePayPalOrder(PP_ORDER, store);
      expect(result).toMatchObject({ ok: true, paymentStatus: 'captured', shouldFinalize: true });
      expect((await store.getOrderById(ORDER_ID))!.paymentStatus).toBe('completed');
    });

    it('подмена суммы: capture с чужой суммой → paid НЕ ставится, ответ amount_mismatch', async () => {
      await seedCreatedPayment(store);
      mock.route(`/v2/checkout/orders/${PP_ORDER}/capture`, () => ({
        status: 201,
        json: completedCaptureBody('99.99'),
      }));

      const result = await capturePayPalOrder(PP_ORDER, store);
      expect(result).toMatchObject({ ok: false, code: 'amount_mismatch' });
      // Заказ НЕ оплачен; факт captured у провайдера зафиксирован для разбора.
      expect((await store.getOrderById(ORDER_ID))!.paymentStatus).toBe('pending');
      expect(store.claimCount).toBe(0);
    });

    it('несовпадение валюты → amount_mismatch', async () => {
      await seedCreatedPayment(store);
      mock.route(`/v2/checkout/orders/${PP_ORDER}/capture`, () => ({
        status: 201,
        json: completedCaptureBody('24.90', 'USD'),
      }));

      const result = await capturePayPalOrder(PP_ORDER, store);
      expect(result).toMatchObject({ ok: false, code: 'amount_mismatch' });
      expect((await store.getOrderById(ORDER_ID))!.paymentStatus).toBe('pending');
    });

    it('PENDING → платёж approved, заказ ждёт вебхука', async () => {
      await seedCreatedPayment(store);
      const pendingBody = completedCaptureBody();
      (pendingBody.purchase_units[0]!.payments.captures[0] as any).status = 'PENDING';
      mock.route(`/v2/checkout/orders/${PP_ORDER}/capture`, () => ({
        status: 201,
        json: pendingBody,
      }));

      const result = await capturePayPalOrder(PP_ORDER, store);
      expect(result).toMatchObject({ ok: true, pending: true, shouldFinalize: false });
      expect((await store.findPaymentByProviderOrderId('paypal', PP_ORDER))!.status).toBe('approved');
      expect((await store.getOrderById(ORDER_ID))!.paymentStatus).toBe('pending');
    });

    it('неизвестный paypalOrderId → payment_not_found', async () => {
      const result = await capturePayPalOrder('PP-UNKNOWN', store);
      expect(result).toMatchObject({ ok: false, code: 'payment_not_found' });
    });
  });

  // -------------------------------------------------------------------
  // Webhook
  // -------------------------------------------------------------------

  describe('processPayPalWebhookEvent', () => {
    it('PAYMENT.CAPTURE.COMPLETED → платёж captured, заказ paid, финализация', async () => {
      await seedCreatedPayment(store);
      const outcome = await processPayPalWebhookEvent(captureCompletedEvent('WH-1') as any, store);

      expect(outcome).toMatchObject({ duplicate: false, handled: true, finalizeOrderId: ORDER_ID });
      const payment = await store.findPaymentByProviderOrderId('paypal', PP_ORDER);
      expect(payment).toMatchObject({ status: 'captured', providerCaptureId: CAPTURE_ID });
      expect((await store.getOrderById(ORDER_ID))!.paymentStatus).toBe('completed');
    });

    it('дубль по event_id → 200-исход без побочных эффектов', async () => {
      await seedCreatedPayment(store);
      const first = await processPayPalWebhookEvent(captureCompletedEvent('WH-1') as any, store);
      const paymentAfterFirst = await store.findPaymentByProviderOrderId('paypal', PP_ORDER);

      const second = await processPayPalWebhookEvent(captureCompletedEvent('WH-1') as any, store);

      expect(first.finalizeOrderId).toBe(ORDER_ID);
      expect(second).toMatchObject({ duplicate: true, handled: false });
      expect(second.finalizeOrderId).toBeUndefined();
      expect(store.claimCount).toBe(1);
      expect(await store.findPaymentByProviderOrderId('paypal', PP_ORDER)).toEqual(
        paymentAfterFirst
      );
    });

    it('вебхук с mismatch-суммой фиксирует событие, но заказ paid не ставит', async () => {
      await seedCreatedPayment(store);
      const outcome = await processPayPalWebhookEvent(
        captureCompletedEvent('WH-1', { amount: { value: '99.99', currency_code: 'EUR' } }) as any,
        store
      );
      expect(outcome.finalizeOrderId).toBeUndefined();
      expect((await store.getOrderById(ORDER_ID))!.paymentStatus).toBe('pending');
    });

    it('DENIED → платёж failed, заказ payment_failed', async () => {
      await seedCreatedPayment(store);
      const outcome = await processPayPalWebhookEvent(
        {
          id: 'WH-2',
          event_type: 'PAYMENT.CAPTURE.DENIED',
          resource: {
            id: CAPTURE_ID,
            status: 'DECLINED',
            custom_id: ORDER_ID,
            supplementary_data: { related_ids: { order_id: PP_ORDER } },
          },
        } as any,
        store
      );
      expect(outcome.handled).toBe(true);
      expect((await store.findPaymentByProviderOrderId('paypal', PP_ORDER))!.status).toBe('failed');
      expect((await store.getOrderById(ORDER_ID))!.paymentStatus).toBe('failed');
    });

    it('DENIED не откатывает уже оплаченный заказ (переходы только вперёд)', async () => {
      await seedCreatedPayment(store);
      await processPayPalWebhookEvent(captureCompletedEvent('WH-1') as any, store);

      await processPayPalWebhookEvent(
        {
          id: 'WH-2',
          event_type: 'PAYMENT.CAPTURE.DENIED',
          resource: {
            id: CAPTURE_ID,
            status: 'DECLINED',
            supplementary_data: { related_ids: { order_id: PP_ORDER } },
          },
        } as any,
        store
      );

      expect((await store.findPaymentByProviderOrderId('paypal', PP_ORDER))!.status).toBe(
        'captured'
      );
      expect((await store.getOrderById(ORDER_ID))!.paymentStatus).toBe('completed');
    });

    it('REFUNDED (внешний возврат из PayPal Dashboard) → строка refunds + статус платежа', async () => {
      await seedCreatedPayment(store);
      await processPayPalWebhookEvent(captureCompletedEvent('WH-1') as any, store);

      const outcome = await processPayPalWebhookEvent(
        {
          id: 'WH-3',
          event_type: 'PAYMENT.CAPTURE.REFUNDED',
          resource: {
            id: 'REF-EXT-1',
            status: 'COMPLETED',
            amount: { value: '24.90', currency_code: 'EUR' },
            links: [
              {
                rel: 'up',
                href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${CAPTURE_ID}`,
              },
            ],
          },
        } as any,
        store
      );

      expect(outcome.handled).toBe(true);
      const payment = await store.findPaymentByProviderOrderId('paypal', PP_ORDER);
      expect(payment!.status).toBe('refunded');
      const refunds = await store.listRefundsByPayment(payment!.id);
      expect(refunds).toHaveLength(1);
      expect(refunds[0]).toMatchObject({
        providerRefundId: 'REF-EXT-1',
        status: 'completed',
        amountMinor: 2490,
        createdBy: 'paypal',
      });
    });

    it('REVERSED → платёж reversed (алерт), заказ не трогаем', async () => {
      await seedCreatedPayment(store);
      await processPayPalWebhookEvent(captureCompletedEvent('WH-1') as any, store);

      await processPayPalWebhookEvent(
        {
          id: 'WH-4',
          event_type: 'PAYMENT.CAPTURE.REVERSED',
          resource: {
            id: CAPTURE_ID,
            supplementary_data: { related_ids: { order_id: PP_ORDER } },
          },
        } as any,
        store
      );

      expect((await store.findPaymentByProviderOrderId('paypal', PP_ORDER))!.status).toBe(
        'reversed'
      );
      expect((await store.getOrderById(ORDER_ID))!.paymentStatus).toBe('completed');
    });

    it('CHECKOUT.ORDER.APPROVED → только статус approved, заказ не меняется', async () => {
      await seedCreatedPayment(store);
      await processPayPalWebhookEvent(
        { id: 'WH-5', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: PP_ORDER } } as any,
        store
      );
      expect((await store.findPaymentByProviderOrderId('paypal', PP_ORDER))!.status).toBe(
        'approved'
      );
      expect((await store.getOrderById(ORDER_ID))!.paymentStatus).toBe('pending');
    });

    it('неизвестный тип события → handled false (роут ответит 200)', async () => {
      const outcome = await processPayPalWebhookEvent(
        { id: 'WH-6', event_type: 'BILLING.PLAN.CREATED', resource: {} } as any,
        store
      );
      expect(outcome).toMatchObject({ duplicate: false, handled: false });
    });

    it('платёж не найден → исключение, событие откатывается (ретрай обработает заново)', async () => {
      await expect(
        processPayPalWebhookEvent(captureCompletedEvent('WH-7') as any, store)
      ).rejects.toThrow(/kein Payment/);
      // Транзакция откатилась: события нет → ретрай PayPal не будет дублем.
      expect(store.events.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------
  // Refund
  // -------------------------------------------------------------------

  describe('refundPayPalPayment', () => {
    async function seedCapturedPayment() {
      const created = await seedCreatedPayment(store);
      await store.updatePaymentLocked(created.id, () => ({
        status: 'captured',
        providerCaptureId: CAPTURE_ID,
      }));
      await store.claimOrderPaid(ORDER_ID);
      return created.id;
    }

    it('частичный возврат → partially_refunded; request-id сохранён ДО вызова PayPal', async () => {
      const paymentId = await seedCapturedPayment();

      let requestIdAtCallTime: string | undefined;
      let pendingRowExistedAtCallTime = false;
      mock.route(`/v2/payments/captures/${CAPTURE_ID}/refund`, (call) => {
        requestIdAtCallTime = call.headers['paypal-request-id'];
        const rows = Array.from(store.refunds.values());
        pendingRowExistedAtCallTime = rows.some(
          (r) => r.requestId === requestIdAtCallTime && r.status === 'pending'
        );
        expect((call.json as any).amount.value).toBe('5.00');
        return { status: 201, json: { id: 'REF-1', status: 'COMPLETED' } };
      });

      const result = await refundPayPalPayment(
        paymentId,
        { amountMinor: 500, reason: 'Reklamation', createdBy: 'admin@test' },
        store
      );

      expect(result).toMatchObject({
        ok: true,
        refundStatus: 'completed',
        paymentStatus: 'partially_refunded',
        amountMinor: 500,
      });
      // Инвариант ТЗ §6.4: сначала строка в БД с request-id, потом вызов API.
      expect(pendingRowExistedAtCallTime).toBe(true);
      expect(requestIdAtCallTime).toBeTruthy();
    });

    it('возврат остатка доводит платёж до refunded', async () => {
      const paymentId = await seedCapturedPayment();
      let n = 0;
      mock.route(`/v2/payments/captures/${CAPTURE_ID}/refund`, () => ({
        status: 201,
        json: { id: `REF-${++n}`, status: 'COMPLETED' },
      }));

      await refundPayPalPayment(paymentId, { amountMinor: 500, createdBy: 'admin@test' }, store);
      const full = await refundPayPalPayment(paymentId, { createdBy: 'admin@test' }, store);

      expect(full).toMatchObject({ ok: true, amountMinor: 1990, paymentStatus: 'refunded' });
    });

    it('без amountMinor выполняется полный возврат остатка', async () => {
      const paymentId = await seedCapturedPayment();
      mock.route(`/v2/payments/captures/${CAPTURE_ID}/refund`, (call) => {
        expect((call.json as any).amount.value).toBe('24.90');
        return { status: 201, json: { id: 'REF-1', status: 'COMPLETED' } };
      });

      const result = await refundPayPalPayment(paymentId, { createdBy: 'admin@test' }, store);
      expect(result).toMatchObject({ ok: true, amountMinor: 2490, paymentStatus: 'refunded' });
    });

    it('refund больше остатка → exceeds_remaining, без вызова PayPal', async () => {
      const paymentId = await seedCapturedPayment();
      const result = await refundPayPalPayment(
        paymentId,
        { amountMinor: 2491, createdBy: 'admin@test' },
        store
      );
      expect(result).toMatchObject({ ok: false, code: 'exceeds_remaining', remainingMinor: 2490 });
      expect(mock.callsTo('/refund')).toHaveLength(0);
    });

    it('незахваченный платёж → not_refundable', async () => {
      const created = await seedCreatedPayment(store);
      const result = await refundPayPalPayment(created.id, { createdBy: 'admin@test' }, store);
      expect(result).toMatchObject({ ok: false, code: 'not_refundable' });
    });

    it('отказ PayPal → строка failed, остаток освобождается для повторной попытки', async () => {
      const paymentId = await seedCapturedPayment();
      let attempt = 0;
      mock.route(`/v2/payments/captures/${CAPTURE_ID}/refund`, () => {
        attempt += 1;
        if (attempt === 1) return { status: 422, json: paypalIssueBody('REFUND_FAILED') };
        return { status: 201, json: { id: 'REF-OK', status: 'COMPLETED' } };
      });

      await expect(
        refundPayPalPayment(paymentId, { amountMinor: 500, createdBy: 'admin@test' }, store)
      ).rejects.toThrow();

      const retry = await refundPayPalPayment(
        paymentId,
        { amountMinor: 500, createdBy: 'admin@test' },
        store
      );
      expect(retry).toMatchObject({ ok: true, amountMinor: 500 });
    });

    it('сетевой сбой → строка остаётся pending, ретрай использует ТОТ ЖЕ request-id', async () => {
      const paymentId = await seedCapturedPayment();
      let attempt = 0;
      mock.route(`/v2/payments/captures/${CAPTURE_ID}/refund`, () => {
        attempt += 1;
        if (attempt === 1) throw new TypeError('network down');
        return { status: 201, json: { id: 'REF-1', status: 'COMPLETED' } };
      });

      await expect(
        refundPayPalPayment(paymentId, { amountMinor: 700, createdBy: 'admin@test' }, store)
      ).rejects.toThrow('network down');

      const retry = await refundPayPalPayment(
        paymentId,
        { amountMinor: 700, createdBy: 'admin@test' },
        store
      );
      expect(retry).toMatchObject({ ok: true, amountMinor: 700 });

      // Оба вызова PayPal шли с одним PayPal-Request-Id (вторых возвратов нет),
      // и строка возврата в БД одна.
      const refundCalls = mock.callsTo('/refund');
      expect(refundCalls).toHaveLength(2);
      expect(refundCalls[0]!.headers['paypal-request-id']).toBe(
        refundCalls[1]!.headers['paypal-request-id']
      );
      const payment = await store.findPaymentById(paymentId);
      expect(await store.listRefundsByPayment(payment!.id)).toHaveLength(1);
    });
  });
});
