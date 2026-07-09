import { v5 as uuidv5 } from 'uuid';
import { randomUUID } from 'crypto';
import { SITE_URL } from '../site-url';
import { SELLER } from '../company';
import { paypalGet, paypalPost, PayPalApiError } from './client';
import { buildAmountBreakdown, buildPurchaseUnit, minorToValue, toMinorUnits } from './amount';
import { canTransition, mapCaptureStatus, type PaymentStatus } from './status';
import { getPayPalStore, type PayPalStore } from './store';
import { logPayPal, logPayPalCritical, logPayPalError } from './log';
import type { Payment } from '../db/schema';

/**
 * Сервисный слой PayPal: create-order / capture / вебхуки / возвраты.
 *
 * Инварианты (ТЗ §2, §6, §8):
 *  - сумма и валюта считаются ТОЛЬКО на сервере из позиций заказа;
 *  - заказ становится оплаченным (paymentStatus='completed') только после
 *    подтверждённого capture COMPLETED при совпадении суммы и валюты;
 *  - идемпотентность: PayPal-Request-Id (детерминированный uuid v5) в исходящих
 *    запросах, UNIQUE(provider, event_id) для вебхуков, FOR UPDATE + CAS при capture;
 *  - финализацию заказа (Telegram/печать/лояльность) запускает ровно один
 *    вызов — тот, чей claimOrderPaid вернул true (паттерн SumUp confirm).
 */

export const PAYPAL_PROVIDER = 'paypal';

/** Фиксированный namespace для uuid v5 (PayPal-Request-Id из order id). */
const PAYPAL_REQUEST_NS = 'a3f2c9e4-5b71-4d06-9c42-7f60d1b2a8c3';

/** Детерминированный PayPal-Request-Id: ретрай того же действия шлёт тот же id. */
export function paypalRequestId(action: 'create' | 'capture', key: string): string {
  return uuidv5(`${action}:${key}`, PAYPAL_REQUEST_NS);
}

// ---------------------------------------------------------------------
// Create order
// ---------------------------------------------------------------------

export type CreateOrderResult =
  | { ok: true; paypalOrderId: string; reused: boolean }
  | {
      ok: false;
      code: 'order_not_found' | 'not_online' | 'already_paid' | 'invalid_amount';
    };

export async function createPayPalOrderForOrder(
  orderId: string,
  store: PayPalStore = getPayPalStore()
): Promise<CreateOrderResult> {
  const order = await store.getOrderById(orderId);
  if (!order) return { ok: false, code: 'order_not_found' };
  if (order.paymentMethod !== 'online') return { ok: false, code: 'not_online' };
  if (order.paymentStatus === 'completed') return { ok: false, code: 'already_paid' };

  // Сумма — только серверная, из позиций заказа в БД (клиентский body игнорируется).
  let breakdown;
  try {
    breakdown = buildAmountBreakdown(order);
  } catch (e) {
    logPayPalCritical('invalid_order_amount', {
      order_id: orderId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, code: 'invalid_amount' };
  }

  // Уже есть свежий PayPal Order с той же суммой → переиспользуем, дублей не плодим.
  const reusable = await store.findReusableCreatedPayment(
    orderId,
    PAYPAL_PROVIDER,
    breakdown.totalMinor
  );
  if (reusable) {
    logPayPal('create_order_reused', {
      order_id: orderId,
      paypal_order_id: reusable.providerOrderId,
    });
    return { ok: true, paypalOrderId: reusable.providerOrderId, reused: true };
  }

  const body = {
    intent: 'CAPTURE',
    purchase_units: [buildPurchaseUnit(orderId, breakdown)],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: SELLER.brand,
          locale: 'de-DE',
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
          return_url: `${SITE_URL}/checkout?paypal=return`,
          cancel_url: `${SITE_URL}/checkout?paypal=cancel`,
        },
      },
    },
  };

  const res = await paypalPost<{ id?: string }>(
    '/v2/checkout/orders',
    body,
    paypalRequestId('create', orderId)
  );
  const paypalOrderId = res.data?.id;
  if (!paypalOrderId) {
    throw new PayPalApiError('PayPal create order: Antwort ohne id', res.status, res.data);
  }

  await store.insertPaymentCreated({
    orderId,
    provider: PAYPAL_PROVIDER,
    providerOrderId: paypalOrderId,
    status: 'created',
    amountMinor: breakdown.totalMinor,
    currency: breakdown.currency,
    rawPayload: res.data,
  });

  logPayPal('create_order', {
    order_id: orderId,
    paypal_order_id: paypalOrderId,
    amount_minor: breakdown.totalMinor,
    currency: breakdown.currency,
  });

  return { ok: true, paypalOrderId, reused: false };
}

// ---------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------

interface CaptureData {
  captureId: string;
  status: string;
  amountValue: string | undefined;
  currencyCode: string | undefined;
}

/** capture из ответа capture-вызова или GET /v2/checkout/orders/{id}. */
function extractCaptureFromOrder(orderData: unknown): CaptureData | null {
  const data = orderData as {
    purchase_units?: Array<{ payments?: { captures?: Array<Record<string, unknown>> } }>;
  } | null;
  const cap = data?.purchase_units?.[0]?.payments?.captures?.[0] as
    | { id?: string; status?: string; amount?: { value?: string; currency_code?: string } }
    | undefined;
  if (!cap?.id) return null;
  return {
    captureId: cap.id,
    status: String(cap.status || ''),
    amountValue: cap.amount?.value,
    currencyCode: cap.amount?.currency_code,
  };
}

/** capture из resource вебхука PAYMENT.CAPTURE.* */
function captureFromWebhookResource(resource: Record<string, unknown>): CaptureData {
  const amount = resource.amount as { value?: string; currency_code?: string } | undefined;
  return {
    captureId: String(resource.id || ''),
    status: String(resource.status || ''),
    amountValue: amount?.value,
    currencyCode: amount?.currency_code,
  };
}

interface ApplyCaptureResult {
  payment: Payment;
  /** capture COMPLETED, но сумма/валюта НЕ совпали с платежом — paid ставить нельзя. */
  mismatch: boolean;
}

/**
 * Применяет данные capture к платежу под блокировкой строки. Идемпотентно:
 * недопустимый переход (уже captured, out-of-order вебхук) — no-op.
 */
async function applyCapture(
  store: PayPalStore,
  paymentId: string,
  capture: CaptureData,
  rawPayload: unknown
): Promise<ApplyCaptureResult> {
  let mismatch = false;

  const payment = await store.updatePaymentLocked(paymentId, (fresh) => {
    const target = mapCaptureStatus(capture.status);
    if (!target) return null;

    if (target === 'captured') {
      // Сверка суммы и валюты с СОХРАНЁННЫМ платежом (который считался из заказа).
      const capturedMinor = toMinorUnits(Number(capture.amountValue));
      if (capturedMinor !== fresh.amountMinor || capture.currencyCode !== fresh.currency) {
        mismatch = true;
      }
    }

    if (!canTransition(fresh.status as PaymentStatus, target)) {
      // Уже в этом или более позднем статусе. Дозаписываем только capture id,
      // если его ещё нет (например, вебхук пришёл раньше ответа capture).
      if (fresh.status === target && capture.captureId && !fresh.providerCaptureId) {
        return { providerCaptureId: capture.captureId, rawPayload };
      }
      return null;
    }

    return {
      status: target,
      providerCaptureId: capture.captureId || fresh.providerCaptureId,
      rawPayload,
    };
  });

  return { payment, mismatch };
}

const ALREADY_CAPTURED_STATUSES: PaymentStatus[] = [
  'captured',
  'refunded',
  'partially_refunded',
  'reversed',
];

export type CaptureResult =
  | {
      ok: true;
      orderId: string;
      paymentStatus: string;
      /** true — заказ переведён в оплаченные ИМЕННО этим вызовом → финализировать. */
      shouldFinalize: boolean;
      alreadyCaptured?: boolean;
      /** capture PENDING — финальное решение придёт вебхуком. */
      pending?: boolean;
    }
  | {
      ok: false;
      code: 'payment_not_found' | 'restart' | 'not_approved' | 'amount_mismatch';
      orderId?: string;
    };

export async function capturePayPalOrder(
  paypalOrderId: string,
  store: PayPalStore = getPayPalStore()
): Promise<CaptureResult> {
  const payment = await store.findPaymentByProviderOrderId(PAYPAL_PROVIDER, paypalOrderId);
  if (!payment) return { ok: false, code: 'payment_not_found' };

  // Идемпотентность: уже захвачен → 200 с текущим состоянием, без второго capture.
  if (ALREADY_CAPTURED_STATUSES.includes(payment.status as PaymentStatus)) {
    return {
      ok: true,
      orderId: payment.orderId,
      paymentStatus: payment.status,
      shouldFinalize: false,
      alreadyCaptured: true,
    };
  }

  let captureSource: unknown;
  try {
    const res = await paypalPost(
      `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
      {},
      paypalRequestId('capture', paypalOrderId)
    );
    captureSource = res.data;
  } catch (e) {
    if (e instanceof PayPalApiError) {
      if (e.issue === 'INSTRUMENT_DECLINED') {
        // Покупатель может выбрать другой способ: фронт вызывает actions.restart().
        logPayPal('capture_instrument_declined', {
          order_id: payment.orderId,
          paypal_order_id: paypalOrderId,
        });
        return { ok: false, code: 'restart', orderId: payment.orderId };
      }
      if (e.issue === 'ORDER_ALREADY_CAPTURED') {
        // Кто-то (ретрай/другая вкладка) уже захватил — синхронизируем состояние.
        const res = await paypalGet(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
        captureSource = res.data;
      } else if (e.issue === 'ORDER_NOT_APPROVED') {
        return { ok: false, code: 'not_approved', orderId: payment.orderId };
      } else {
        logPayPalError('capture_fail', {
          order_id: payment.orderId,
          paypal_order_id: paypalOrderId,
          status: e.status,
          issue: e.issue,
        });
        throw e;
      }
    } else {
      throw e;
    }
  }

  const capture = extractCaptureFromOrder(captureSource);
  if (!capture) {
    // Ответ без capture (заказ не approved и т.п.) — оплатить нельзя.
    return { ok: false, code: 'not_approved', orderId: payment.orderId };
  }

  const { payment: updated, mismatch } = await applyCapture(
    store,
    payment.id,
    capture,
    captureSource
  );

  if (mismatch) {
    logPayPalCritical('amount_mismatch', {
      order_id: payment.orderId,
      paypal_order_id: paypalOrderId,
      capture_id: capture.captureId,
      expected_minor: payment.amountMinor,
      expected_currency: payment.currency,
      captured_value: capture.amountValue,
      captured_currency: capture.currencyCode,
    });
    return { ok: false, code: 'amount_mismatch', orderId: payment.orderId };
  }

  let shouldFinalize = false;
  if (updated.status === 'captured') {
    shouldFinalize = await store.claimOrderPaid(payment.orderId);
    logPayPal('capture_success', {
      order_id: payment.orderId,
      paypal_order_id: paypalOrderId,
      capture_id: updated.providerCaptureId,
      claimed: shouldFinalize,
    });
  } else if (updated.status === 'failed') {
    await store.markOrderPaymentFailed(payment.orderId);
    logPayPal('capture_fail', { order_id: payment.orderId, paypal_order_id: paypalOrderId });
  }

  return {
    ok: true,
    orderId: payment.orderId,
    paymentStatus: updated.status,
    shouldFinalize,
    pending: updated.status === 'approved',
  };
}

// ---------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------

export interface PayPalWebhookEvent {
  id: string;
  event_type: string;
  resource?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WebhookOutcome {
  duplicate: boolean;
  handled: boolean;
  /** Заказ переведён в оплаченные этим событием → маршрут запускает финализацию. */
  finalizeOrderId?: string;
}

/** Платёж по resource события PAYMENT.CAPTURE.*: related order id → capture id → custom_id. */
async function resolvePaymentForCaptureResource(
  store: PayPalStore,
  resource: Record<string, unknown>
): Promise<Payment | null> {
  const related = (resource.supplementary_data as
    | { related_ids?: { order_id?: string } }
    | undefined)?.related_ids;
  if (related?.order_id) {
    const byOrder = await store.findPaymentByProviderOrderId(
      PAYPAL_PROVIDER,
      String(related.order_id)
    );
    if (byOrder) return byOrder;
  }
  if (resource.id) {
    const byCapture = await store.findPaymentByCaptureId(PAYPAL_PROVIDER, String(resource.id));
    if (byCapture) return byCapture;
  }
  if (resource.custom_id) {
    // custom_id = наш внутренний order id (см. buildPurchaseUnit)
    const candidates = await store.listPaymentsByOrder(String(resource.custom_id));
    return candidates.find((p) => p.provider === PAYPAL_PROVIDER) || null;
  }
  return null;
}

/** id capture из ссылки "up" refund-ресурса (/v2/payments/captures/{id}). */
function captureIdFromRefundLinks(resource: Record<string, unknown>): string | null {
  const links = resource.links as Array<{ rel?: string; href?: string }> | undefined;
  const up = links?.find((l) => l.rel === 'up')?.href;
  const match = up?.match(/\/captures\/([^/?]+)/);
  return match ? match[1]! : null;
}

async function handleCaptureCompleted(
  store: PayPalStore,
  event: PayPalWebhookEvent
): Promise<WebhookOutcome> {
  const resource = event.resource || {};
  const payment = await resolvePaymentForCaptureResource(store, resource);
  if (!payment) {
    // Платёж не найден — бросаем, чтобы транзакция откатилась и событие НЕ
    // записалось: ретрай PayPal обработает его, когда данные будут на месте.
    throw new Error(`PayPal webhook: kein Payment für Capture ${String(resource.id)}`);
  }

  const capture = captureFromWebhookResource(resource);
  const { payment: updated, mismatch } = await applyCapture(store, payment.id, capture, event);

  if (mismatch) {
    logPayPalCritical('amount_mismatch', {
      source: 'webhook',
      event_id: event.id,
      order_id: payment.orderId,
      capture_id: capture.captureId,
      expected_minor: payment.amountMinor,
      captured_value: capture.amountValue,
      captured_currency: capture.currencyCode,
    });
    // Событие записано (алерт по critical-логу), заказ paid НЕ становится.
    return { duplicate: false, handled: true };
  }

  if (updated.status === 'captured') {
    const claimed = await store.claimOrderPaid(payment.orderId);
    logPayPal('webhook_capture_completed', {
      event_id: event.id,
      order_id: payment.orderId,
      claimed,
    });
    return {
      duplicate: false,
      handled: true,
      finalizeOrderId: claimed ? payment.orderId : undefined,
    };
  }
  return { duplicate: false, handled: true };
}

async function handleCaptureFailed(
  store: PayPalStore,
  event: PayPalWebhookEvent
): Promise<WebhookOutcome> {
  const resource = event.resource || {};
  const payment = await resolvePaymentForCaptureResource(store, resource);
  if (!payment) {
    throw new Error(`PayPal webhook: kein Payment für Capture ${String(resource.id)}`);
  }
  await store.updatePaymentLocked(payment.id, (fresh) => {
    if (!canTransition(fresh.status as PaymentStatus, 'failed')) return null;
    return { status: 'failed', rawPayload: event };
  });
  await store.markOrderPaymentFailed(payment.orderId);
  logPayPal('webhook_capture_failed', { event_id: event.id, order_id: payment.orderId });
  return { duplicate: false, handled: true };
}

/** Пересчёт статуса платежа по завершённым возвратам (partially_refunded/refunded). */
async function recomputeRefundStatus(store: PayPalStore, paymentId: string): Promise<void> {
  const completedMinor = await store.sumRefundsMinor(paymentId, ['completed']);
  if (completedMinor <= 0) return;
  await store.updatePaymentLocked(paymentId, (fresh) => {
    const target: PaymentStatus =
      completedMinor >= fresh.amountMinor ? 'refunded' : 'partially_refunded';
    if (!canTransition(fresh.status as PaymentStatus, target)) return null;
    return { status: target };
  });
}

async function handleCaptureRefunded(
  store: PayPalStore,
  event: PayPalWebhookEvent
): Promise<WebhookOutcome> {
  const resource = event.resource || {};
  const providerRefundId = String(resource.id || '');
  if (!providerRefundId) return { duplicate: false, handled: false };

  let refundRow = await store.findRefundByProviderRefundId(providerRefundId);
  let payment: Payment | null = null;

  if (refundRow) {
    payment = await store.findPaymentById(refundRow.paymentId);
  } else {
    const captureId = captureIdFromRefundLinks(resource);
    if (captureId) {
      payment = await store.findPaymentByCaptureId(PAYPAL_PROVIDER, captureId);
    }
    if (!payment && resource.custom_id) {
      const candidates = await store.listPaymentsByOrder(String(resource.custom_id));
      payment = candidates.find((p) => p.provider === PAYPAL_PROVIDER) || null;
    }
  }

  if (!payment) {
    throw new Error(`PayPal webhook: kein Payment für Refund ${providerRefundId}`);
  }

  const amount = resource.amount as { value?: string } | undefined;
  if (!refundRow) {
    // Возврат, сделанный вне приложения (PayPal Dashboard) — фиксируем строкой.
    refundRow = await store.insertRefund({
      paymentId: payment.id,
      requestId: `ext:${providerRefundId}`,
      amountMinor: toMinorUnits(Number(amount?.value)),
      status: 'completed',
      providerRefundId,
      createdBy: 'paypal',
      reason: 'Externer Refund (PayPal Dashboard)',
    });
  } else if (refundRow.status !== 'completed') {
    await store.updateRefund(refundRow.id, { status: 'completed', providerRefundId });
  }

  await recomputeRefundStatus(store, payment.id);
  logPayPal('webhook_capture_refunded', {
    event_id: event.id,
    order_id: payment.orderId,
    refund_id: providerRefundId,
  });
  return { duplicate: false, handled: true };
}

async function handleCaptureReversed(
  store: PayPalStore,
  event: PayPalWebhookEvent
): Promise<WebhookOutcome> {
  const resource = event.resource || {};
  const payment = await resolvePaymentForCaptureResource(store, resource);
  if (!payment) {
    throw new Error(`PayPal webhook: kein Payment für Reversal ${String(resource.id)}`);
  }
  await store.updatePaymentLocked(payment.id, (fresh) => {
    if (!canTransition(fresh.status as PaymentStatus, 'reversed')) return null;
    return { status: 'reversed', rawPayload: event };
  });
  // Алерт: деньги отозваны (chargeback/reversal) по уже оплаченному заказу.
  logPayPalCritical('capture_reversed', {
    event_id: event.id,
    order_id: payment.orderId,
    capture_id: String(resource.id || ''),
  });
  return { duplicate: false, handled: true };
}

async function handleOrderApproved(
  store: PayPalStore,
  event: PayPalWebhookEvent
): Promise<WebhookOutcome> {
  const resource = event.resource || {};
  const paypalOrderId = String(resource.id || '');
  const payment = paypalOrderId
    ? await store.findPaymentByProviderOrderId(PAYPAL_PROVIDER, paypalOrderId)
    : null;
  if (payment) {
    // Только фиксация статуса: capture инициирует клиент (ТЗ §6.3).
    await store.updatePaymentLocked(payment.id, (fresh) => {
      if (!canTransition(fresh.status as PaymentStatus, 'approved')) return null;
      return { status: 'approved' };
    });
  }
  logPayPal('webhook_order_approved', { event_id: event.id, paypal_order_id: paypalOrderId });
  return { duplicate: false, handled: true };
}

/**
 * Обработка верифицированного события вебхука. Запись события и вся обработка —
 * в одной транзакции: сбой на середине откатывает и запись, и изменения, и
 * ретрай PayPal обрабатывает событие заново. Дубль по event_id — no-op.
 */
export async function processPayPalWebhookEvent(
  event: PayPalWebhookEvent,
  store: PayPalStore = getPayPalStore()
): Promise<WebhookOutcome> {
  return store.runInTransaction(async (s) => {
    const isNew = await s.insertEventIfNew(PAYPAL_PROVIDER, event.id, event.event_type, event);
    if (!isNew) {
      logPayPal('webhook_duplicate', { event_id: event.id, event_type: event.event_type });
      return { duplicate: true, handled: false };
    }

    switch (event.event_type) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        return handleCaptureCompleted(s, event);
      case 'PAYMENT.CAPTURE.DENIED':
      case 'PAYMENT.CAPTURE.DECLINED':
        return handleCaptureFailed(s, event);
      case 'PAYMENT.CAPTURE.REFUNDED':
        return handleCaptureRefunded(s, event);
      case 'PAYMENT.CAPTURE.REVERSED':
        return handleCaptureReversed(s, event);
      case 'CHECKOUT.ORDER.APPROVED':
        return handleOrderApproved(s, event);
      default:
        // Неизвестный тип: 200 + лог (PayPal ретраит на любой не-2xx).
        logPayPal('webhook_unhandled', { event_id: event.id, event_type: event.event_type });
        return { duplicate: false, handled: false };
    }
  });
}

// ---------------------------------------------------------------------
// Refund (админ)
// ---------------------------------------------------------------------

export type RefundResult =
  | {
      ok: true;
      refundId: string;
      providerRefundId: string | null;
      refundStatus: string;
      paymentStatus: string;
      amountMinor: number;
    }
  | {
      ok: false;
      code: 'payment_not_found' | 'not_refundable' | 'invalid_amount' | 'exceeds_remaining';
      remainingMinor?: number;
    };

export async function refundPayPalPayment(
  paymentId: string,
  params: { amountMinor?: number; reason?: string; createdBy: string },
  store: PayPalStore = getPayPalStore()
): Promise<RefundResult> {
  const payment = await store.findPaymentById(paymentId);
  if (!payment || payment.provider !== PAYPAL_PROVIDER) {
    return { ok: false, code: 'payment_not_found' };
  }
  if (
    !payment.providerCaptureId ||
    !['captured', 'partially_refunded'].includes(payment.status)
  ) {
    return { ok: false, code: 'not_refundable' };
  }

  // pending-возвраты тоже занимают остаток: незавершённый возврат не должен
  // позволить вернуть больше captured-суммы.
  const activeMinor = await store.sumRefundsMinor(payment.id, ['pending', 'completed']);
  const remainingMinor = payment.amountMinor - activeMinor;

  const requested = params.amountMinor ?? remainingMinor;
  if (!Number.isInteger(requested) || requested <= 0) {
    return { ok: false, code: 'invalid_amount', remainingMinor };
  }
  if (requested > remainingMinor) {
    return { ok: false, code: 'exceeds_remaining', remainingMinor };
  }

  // PayPal-Request-Id фиксируется в БД ДО вызова API: ретрай после сбоя
  // переиспользует ту же строку и тот же id → второй возврат не создаётся.
  let refundRow = await store.findPendingRefundWithoutProviderId(payment.id, requested);
  if (!refundRow) {
    refundRow = await store.insertRefund({
      paymentId: payment.id,
      requestId: randomUUID(),
      amountMinor: requested,
      status: 'pending',
      reason: params.reason || null,
      createdBy: params.createdBy,
    });
  }

  let refundData: { id?: string; status?: string };
  try {
    const res = await paypalPost<{ id?: string; status?: string }>(
      `/v2/payments/captures/${encodeURIComponent(payment.providerCaptureId)}/refund`,
      {
        amount: {
          value: minorToValue(requested),
          currency_code: payment.currency,
        },
      },
      refundRow.requestId
    );
    refundData = res.data || {};
  } catch (e) {
    if (e instanceof PayPalApiError) {
      // Отказ провайдера — возврат не состоялся, строка освобождает остаток.
      await store.updateRefund(refundRow.id, { status: 'failed' });
      logPayPalError('refund_fail', {
        payment_id: payment.id,
        order_id: payment.orderId,
        status: e.status,
        issue: e.issue,
      });
    }
    // Сетевой сбой (не PayPalApiError): исход неизвестен — строка остаётся
    // pending, повторный вызов переиспользует её request_id.
    throw e;
  }

  const refundStatus =
    refundData.status === 'COMPLETED'
      ? 'completed'
      : refundData.status === 'CANCELLED' || refundData.status === 'FAILED'
        ? 'failed'
        : 'pending';

  await store.updateRefund(refundRow.id, {
    providerRefundId: refundData.id || null,
    status: refundStatus,
  });

  if (refundStatus === 'completed') {
    await recomputeRefundStatus(store, payment.id);
  }
  // PENDING: финальный статус подтвердит вебхук PAYMENT.CAPTURE.REFUNDED.

  const updated = await store.findPaymentById(payment.id);
  logPayPal('refund', {
    payment_id: payment.id,
    order_id: payment.orderId,
    refund_id: refundData.id,
    amount_minor: requested,
    status: refundStatus,
  });

  return {
    ok: true,
    refundId: refundRow.id,
    providerRefundId: refundData.id || null,
    refundStatus,
    paymentStatus: updated?.status || payment.status,
    amountMinor: requested,
  };
}
