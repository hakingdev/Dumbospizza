import { NextRequest, NextResponse } from 'next/server';
import { Order } from '../../../../../lib/models/order.model';
import { finalizeOrderPlacement } from '../../../../../lib/orders/finalize';
import {
  processPayPalWebhookEvent,
  type PayPalWebhookEvent,
} from '../../../../../lib/paypal/service';
import {
  extractWebhookHeaders,
  isTrustedCertUrl,
  verifyWebhookSignature,
} from '../../../../../lib/paypal/webhook';
import { PayPalApiError } from '../../../../../lib/paypal/client';
import { logPayPal, logPayPalCritical, logPayPalError } from '../../../../../lib/paypal/log';
import { logSecurityEvent } from '../../../../../lib/security/rate-limit';

/**
 * POST /api/payments/paypal/webhook
 *
 * Публичный эндпоинт для событий PayPal (без CSRF/сессии). Порядок жёсткий:
 *  1. Сырое тело читается ДО JSON-парсинга (подпись считается по байтам).
 *  2. cert_url обязан быть на https://*.paypal.com — иначе 401 до вызова API.
 *  3. Подпись верифицируется через /v1/notifications/verify-webhook-signature
 *     с PAYPAL_WEBHOOK_ID из env; не SUCCESS → 401, состояние НЕ меняется.
 *  4. Дубли отбрасываются по UNIQUE(provider, event_id) → 200.
 *  5. Обработка и запись события — в одной транзакции; сбой → 5xx → PayPal
 *     ретраит, состояние согласовано (откат).
 *
 * ВАЖНО (deploy): URL вебхука в PayPal Dashboard задавать на КАНОНИЧЕСКОМ
 * домене https://www.dumbospizza.de/... — apex отвечает 301 (middleware), и
 * POST до обработчика не доходит (тот же грабль, что у Telegram-вебхука).
 */
export async function POST(request: NextRequest) {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ received: false }, { status: 400 });
  }

  const headers = extractWebhookHeaders(request.headers);
  if (!headers) {
    logSecurityEvent('paypal-webhook-missing-headers', {});
    return NextResponse.json({ received: false }, { status: 401 });
  }

  if (!isTrustedCertUrl(headers.certUrl)) {
    logSecurityEvent('paypal-webhook-untrusted-cert-url', { certUrl: headers.certUrl });
    return NextResponse.json({ received: false }, { status: 401 });
  }

  let event: PayPalWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ received: false }, { status: 400 });
  }
  if (!event || typeof event.id !== 'string' || typeof event.event_type !== 'string') {
    return NextResponse.json({ received: false }, { status: 400 });
  }

  let verified: boolean;
  try {
    verified = await verifyWebhookSignature(headers, rawBody);
  } catch (error) {
    // Верификацию выполнить не удалось (сеть/PayPal) — это НЕ «невалидная
    // подпись»: отвечаем 503, PayPal повторит доставку.
    logPayPalError('webhook_verify_unavailable', {
      event_id: event.id,
      status: error instanceof PayPalApiError ? error.status : undefined,
    });
    return NextResponse.json({ received: false }, { status: 503 });
  }

  if (!verified) {
    // Счётчик paypal_webhook_verify_fail + security-событие для алерта.
    logPayPalError('webhook_verify_fail', { event_id: event.id, event_type: event.event_type });
    logSecurityEvent('paypal-webhook-verify-fail', { eventId: event.id });
    return NextResponse.json({ received: false }, { status: 401 });
  }

  try {
    const outcome = await processPayPalWebhookEvent(event);

    // Финализация вне транзакции: заказ уже помечен оплаченным атомарным
    // claim'ом, побочные эффекты (Telegram/печать/лояльность) — best-effort.
    if (outcome.finalizeOrderId) {
      try {
        const orderDoc = await Order.findById(outcome.finalizeOrderId);
        if (orderDoc) await finalizeOrderPlacement(orderDoc, request);
      } catch (error) {
        logPayPalCritical('finalize_failed', {
          order_id: outcome.finalizeOrderId,
          source: 'webhook',
          event_id: event.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return NextResponse.json({ received: true, duplicate: outcome.duplicate });
  } catch (error) {
    // Транзакция откатилась (событие не записано) → 500, PayPal ретраит.
    logPayPalError('webhook_processing_failed', {
      event_id: event.id,
      event_type: event.event_type,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ received: false }, { status: 500 });
  }
}

/** Health-check для настройки вебхука (PayPal шлёт только POST). */
export async function GET() {
  logPayPal('webhook_ping', {});
  return NextResponse.json({ ok: true });
}
