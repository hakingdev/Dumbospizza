// @vitest-environment node
//
// Тесты HTTP-слоя: верификация вебхука (401 без изменений состояния), владение
// заказом (403), игнорирование клиентской суммы, restart-контракт capture,
// admin-права и лимиты refund. PayPal API — fetch-мок, БД — in-memory store,
// финализация и Order-модель замоканы.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const finalizeMock = vi.hoisted(() => vi.fn(async () => undefined));
const orderFindByIdMock = vi.hoisted(() => vi.fn(async (id: string) => ({ _id: id })));
const getServerSessionMock = vi.hoisted(() => vi.fn(async () => null as any));

vi.mock('../../orders/finalize', () => ({
  finalizeOrderPlacement: finalizeMock,
  buildOrderNotification: vi.fn(),
}));
vi.mock('../../models/order.model', () => ({
  Order: { findById: orderFindByIdMock },
}));
vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
  default: vi.fn(),
}));

import { POST as createOrderRoute } from '../../../app/api/payments/paypal/create-order/route';
import { POST as captureRoute } from '../../../app/api/payments/paypal/capture/route';
import { POST as webhookRoute } from '../../../app/api/payments/paypal/webhook/route';
import { POST as refundRoute } from '../../../app/api/admin/payments/[paymentId]/refund/route';
import { setPayPalStoreForTests } from '../store';
import { resetPayPalConfigForTests } from '../config';
import { resetPayPalTokenCacheForTests } from '../client';
import { signOrderAccessToken } from '../../orders/access-token';
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

function post(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function webhookHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api.sandbox.paypal.com/cert/test.pem',
    'paypal-transmission-id': 'tx-1',
    'paypal-transmission-sig': 'sig-1',
    'paypal-transmission-time': '2026-07-09T12:00:00Z',
    ...overrides,
  };
}

function captureCompletedEvent(eventId: string) {
  return {
    id: eventId,
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {
      id: CAPTURE_ID,
      status: 'COMPLETED',
      amount: { value: '24.90', currency_code: 'EUR' },
      custom_id: ORDER_ID,
      supplementary_data: { related_ids: { order_id: PP_ORDER } },
    },
  };
}

describe('PayPal HTTP routes', () => {
  let mock: PayPalFetchMock;
  let store: MemoryPayPalStore;

  beforeEach(() => {
    stubPayPalEnv();
    resetPayPalConfigForTests();
    resetPayPalTokenCacheForTests();
    mock = installPayPalFetchMock();
    store = new MemoryPayPalStore();
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
    setPayPalStoreForTests(store);
    finalizeMock.mockClear();
    orderFindByIdMock.mockClear();
    getServerSessionMock.mockReset();
    getServerSessionMock.mockResolvedValue(null);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    setPayPalStoreForTests(null);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function seedCreatedPayment() {
    return store.insertPaymentCreated({
      orderId: ORDER_ID,
      provider: 'paypal',
      providerOrderId: PP_ORDER,
      status: 'created',
      amountMinor: 2490,
      currency: 'EUR',
    });
  }

  const ownerHeaders = () => ({ 'x-order-access-token': signOrderAccessToken(ORDER_ID) });

  // -------------------------------------------------------------------
  // POST /api/payments/paypal/create-order
  // -------------------------------------------------------------------

  describe('create-order', () => {
    it('без токена владельца → 403, PayPal не вызывается', async () => {
      const res = await createOrderRoute(post('/api/payments/paypal/create-order', { orderId: ORDER_ID }));
      expect(res.status).toBe(403);
      expect(mock.callsTo('/v2/checkout/orders')).toHaveLength(0);
    });

    it('подмена суммы в body игнорируется — серверная сумма выигрывает', async () => {
      mock.route('/v2/checkout/orders', () => ({ status: 201, json: { id: PP_ORDER } }));

      const res = await createOrderRoute(
        post(
          '/api/payments/paypal/create-order',
          // Клиент пытается заплатить 1 цент: посторонние поля не читаются.
          { orderId: ORDER_ID, amount: 0.01, total: 0.01, currency: 'USD' },
          ownerHeaders()
        )
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ success: true, paypalOrderId: PP_ORDER });

      const call = mock.callsTo('/v2/checkout/orders')[0]!;
      expect((call.json as any).purchase_units[0].amount.value).toBe('24.90');
      expect((call.json as any).purchase_units[0].amount.currency_code).toBe('EUR');
      expect((await store.findPaymentByProviderOrderId('paypal', PP_ORDER))!.amountMinor).toBe(
        2490
      );
    });

    it('неизвестный заказ → 404', async () => {
      const res = await createOrderRoute(
        post('/api/payments/paypal/create-order', { orderId: 'missing' }, ownerHeaders())
      );
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // POST /api/payments/paypal/capture
  // -------------------------------------------------------------------

  describe('capture', () => {
    it('без токена владельца → 403', async () => {
      await seedCreatedPayment();
      const res = await captureRoute(
        post('/api/payments/paypal/capture', { paypalOrderId: PP_ORDER })
      );
      expect(res.status).toBe(403);
    });

    it('COMPLETED → 200, финализация вызвана один раз; повторный capture — без второй', async () => {
      await seedCreatedPayment();
      mock.route(`/v2/checkout/orders/${PP_ORDER}/capture`, () => ({
        status: 201,
        json: {
          id: PP_ORDER,
          status: 'COMPLETED',
          purchase_units: [
            {
              payments: {
                captures: [
                  {
                    id: CAPTURE_ID,
                    status: 'COMPLETED',
                    amount: { value: '24.90', currency_code: 'EUR' },
                  },
                ],
              },
            },
          ],
        },
      }));

      const first = await captureRoute(
        post('/api/payments/paypal/capture', { paypalOrderId: PP_ORDER }, ownerHeaders())
      );
      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({ success: true, orderId: ORDER_ID });
      expect(finalizeMock).toHaveBeenCalledTimes(1);

      const second = await captureRoute(
        post('/api/payments/paypal/capture', { paypalOrderId: PP_ORDER }, ownerHeaders())
      );
      expect(second.status).toBe(200);
      expect(await second.json()).toMatchObject({ success: true, alreadyPaid: true });
      expect(finalizeMock).toHaveBeenCalledTimes(1);
      expect(store.claimCount).toBe(1);
    });

    it('INSTRUMENT_DECLINED → 422 { restart: true }', async () => {
      await seedCreatedPayment();
      mock.route(`/v2/checkout/orders/${PP_ORDER}/capture`, () => ({
        status: 422,
        json: paypalIssueBody('INSTRUMENT_DECLINED'),
      }));

      const res = await captureRoute(
        post('/api/payments/paypal/capture', { paypalOrderId: PP_ORDER }, ownerHeaders())
      );
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ restart: true });
      expect(finalizeMock).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  // POST /api/payments/paypal/webhook
  // -------------------------------------------------------------------

  describe('webhook', () => {
    it('невалидная подпись → 401, состояние не изменилось', async () => {
      await seedCreatedPayment();
      mock.route('/v1/notifications/verify-webhook-signature', () => ({
        json: { verification_status: 'FAILURE' },
      }));

      const res = await webhookRoute(
        post('/api/payments/paypal/webhook', captureCompletedEvent('WH-1'), webhookHeaders())
      );

      expect(res.status).toBe(401);
      expect(store.events.size).toBe(0);
      expect((await store.getOrderById(ORDER_ID))!.paymentStatus).toBe('pending');
      expect((await store.findPaymentByProviderOrderId('paypal', PP_ORDER))!.status).toBe(
        'created'
      );
      expect(finalizeMock).not.toHaveBeenCalled();
    });

    it('cert_url не на *.paypal.com → 401 ДО вызова verify-API', async () => {
      await seedCreatedPayment();
      const res = await webhookRoute(
        post(
          '/api/payments/paypal/webhook',
          captureCompletedEvent('WH-1'),
          webhookHeaders({ 'paypal-cert-url': 'https://evil.example.com/cert.pem' })
        )
      );
      expect(res.status).toBe(401);
      expect(mock.callsTo('/v1/notifications/verify-webhook-signature')).toHaveLength(0);
      expect(store.events.size).toBe(0);
    });

    it('отсутствуют заголовки передачи → 401', async () => {
      const res = await webhookRoute(
        post('/api/payments/paypal/webhook', captureCompletedEvent('WH-1'))
      );
      expect(res.status).toBe(401);
    });

    it('валидное событие → 200, заказ paid, финализация один раз; дубль → 200 без эффектов', async () => {
      await seedCreatedPayment();
      mock.route('/v1/notifications/verify-webhook-signature', () => ({
        json: { verification_status: 'SUCCESS' },
      }));

      const first = await webhookRoute(
        post('/api/payments/paypal/webhook', captureCompletedEvent('WH-1'), webhookHeaders())
      );
      expect(first.status).toBe(200);
      expect((await store.getOrderById(ORDER_ID))!.paymentStatus).toBe('completed');
      expect(finalizeMock).toHaveBeenCalledTimes(1);

      // Resend того же события из PayPal Dashboard: дубль по event_id.
      const second = await webhookRoute(
        post('/api/payments/paypal/webhook', captureCompletedEvent('WH-1'), webhookHeaders())
      );
      expect(second.status).toBe(200);
      expect(await second.json()).toMatchObject({ received: true, duplicate: true });
      expect(finalizeMock).toHaveBeenCalledTimes(1);
      expect(store.claimCount).toBe(1);
    });

    it('вебхук раньше capture: событие финализирует, последующий capture-роут — нет', async () => {
      await seedCreatedPayment();
      mock.route('/v1/notifications/verify-webhook-signature', () => ({
        json: { verification_status: 'SUCCESS' },
      }));

      const wh = await webhookRoute(
        post('/api/payments/paypal/webhook', captureCompletedEvent('WH-1'), webhookHeaders())
      );
      expect(wh.status).toBe(200);
      expect(finalizeMock).toHaveBeenCalledTimes(1);

      const cap = await captureRoute(
        post('/api/payments/paypal/capture', { paypalOrderId: PP_ORDER }, ownerHeaders())
      );
      expect(cap.status).toBe(200);
      expect(await cap.json()).toMatchObject({ success: true, alreadyPaid: true });
      // Двойного paid нет: финализация по-прежнему одна.
      expect(finalizeMock).toHaveBeenCalledTimes(1);
      expect(store.claimCount).toBe(1);
    });

    it('верификация недоступна (сбой сети) → 503, PayPal ретраит', async () => {
      await seedCreatedPayment();
      mock.route('/v1/notifications/verify-webhook-signature', () => {
        throw new TypeError('network down');
      });
      const res = await webhookRoute(
        post('/api/payments/paypal/webhook', captureCompletedEvent('WH-1'), webhookHeaders())
      );
      expect(res.status).toBe(503);
      expect(store.events.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------
  // POST /api/admin/payments/{paymentId}/refund
  // -------------------------------------------------------------------

  describe('admin refund', () => {
    async function seedCapturedPayment() {
      const created = await seedCreatedPayment();
      await store.updatePaymentLocked(created.id, () => ({
        status: 'captured',
        providerCaptureId: CAPTURE_ID,
      }));
      await store.claimOrderPaid(ORDER_ID);
      return created.id;
    }

    const asAdmin = () =>
      getServerSessionMock.mockResolvedValue({ user: { role: 'admin', email: 'admin@test' } });

    it('без сессии → 401', async () => {
      const paymentId = await seedCapturedPayment();
      const res = await refundRoute(
        post(`/api/admin/payments/${paymentId}/refund`, { amountMinor: 500 }),
        { params: { paymentId } }
      );
      expect(res.status).toBe(401);
      expect(mock.callsTo('/refund')).toHaveLength(0);
    });

    it('staff (не admin) → 401', async () => {
      getServerSessionMock.mockResolvedValue({ user: { role: 'staff', email: 'staff@test' } });
      const paymentId = await seedCapturedPayment();
      const res = await refundRoute(
        post(`/api/admin/payments/${paymentId}/refund`, { amountMinor: 500 }),
        { params: { paymentId } }
      );
      expect(res.status).toBe(401);
    });

    it('частичный возврат → 200, partially_refunded', async () => {
      asAdmin();
      const paymentId = await seedCapturedPayment();
      mock.route(`/v2/payments/captures/${CAPTURE_ID}/refund`, () => ({
        status: 201,
        json: { id: 'REF-1', status: 'COMPLETED' },
      }));

      const res = await refundRoute(
        post(`/api/admin/payments/${paymentId}/refund`, { amountMinor: 500, reason: 'Test' }),
        { params: { paymentId } }
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        success: true,
        paymentStatus: 'partially_refunded',
        refund: { amountMinor: 500, status: 'completed' },
      });
    });

    it('refund больше остатка → 400 c remainingMinor', async () => {
      asAdmin();
      const paymentId = await seedCapturedPayment();
      const res = await refundRoute(
        post(`/api/admin/payments/${paymentId}/refund`, { amountMinor: 999999 }),
        { params: { paymentId } }
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ success: false, remainingMinor: 2490 });
      expect(mock.callsTo('/refund')).toHaveLength(0);
    });

    it('дробный/нулевой amountMinor → 400', async () => {
      asAdmin();
      const paymentId = await seedCapturedPayment();
      for (const bad of [0, -5, 5.5, '500']) {
        const res = await refundRoute(
          post(`/api/admin/payments/${paymentId}/refund`, { amountMinor: bad }),
          { params: { paymentId } }
        );
        expect(res.status).toBe(400);
      }
    });
  });
});
