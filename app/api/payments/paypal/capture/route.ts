import { NextRequest, NextResponse } from 'next/server';
import { Order } from '../../../../../lib/models/order.model';
import { finalizeOrderPlacement } from '../../../../../lib/orders/finalize';
import { capturePayPalOrder, PAYPAL_PROVIDER } from '../../../../../lib/paypal/service';
import { getPayPalStore } from '../../../../../lib/paypal/store';
import { canAccessOrder } from '../../../../../lib/paypal/ownership';
import { PayPalApiError } from '../../../../../lib/paypal/client';
import { logPayPalCritical, logPayPalError } from '../../../../../lib/paypal/log';
import { getClientIp, logSecurityEvent, rateLimit } from '../../../../../lib/security/rate-limit';

/**
 * POST /api/payments/paypal/capture
 * Body: { paypalOrderId }
 *
 * Capture после approve покупателя (onApprove у PayPal-кнопок). Идемпотентен:
 * уже захваченный платёж возвращает 200 с текущим состоянием, ровно один из
 * конкурентных вызовов (включая вебхук) финализирует заказ. Заказ становится
 * оплаченным только при capture COMPLETED с совпавшей суммой/валютой.
 *
 * Особые ответы:
 *  - 422 { restart: true } — INSTRUMENT_DECLINED, фронт вызывает actions.restart()
 *  - 200 { pending: true } — capture PENDING, финальное решение придёт вебхуком
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const rl = rateLimit(`paypal-capture:${ip}`, 15, 60_000);
    if (!rl.allowed) {
      logSecurityEvent('paypal-capture-rate-limited', { ip });
      return NextResponse.json(
        { success: false, error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
      );
    }

    const body = await request.json().catch(() => null);
    const paypalOrderId = body?.paypalOrderId;
    if (!paypalOrderId || typeof paypalOrderId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'paypalOrderId is required' },
        { status: 400 }
      );
    }

    const store = getPayPalStore();

    // Владение: платёж → заказ → HMAC-токен заказа или клиентская сессия.
    const payment = await store.findPaymentByProviderOrderId(PAYPAL_PROVIDER, paypalOrderId);
    if (!payment) {
      return NextResponse.json({ success: false, error: 'Payment not found' }, { status: 404 });
    }
    const order = await store.getOrderById(payment.orderId);
    if (!order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }
    if (!canAccessOrder(request, order)) {
      logSecurityEvent('paypal-capture-forbidden', { ip, orderId: order.id });
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const result = await capturePayPalOrder(paypalOrderId, store);

    // `=== false` вместо `!ok`: под strict:false только так сужается union
    if (result.ok === false) {
      switch (result.code) {
        case 'restart':
          // INSTRUMENT_DECLINED: покупатель выбирает другой способ в том же окне.
          return NextResponse.json({ success: false, restart: true }, { status: 422 });
        case 'not_approved':
          return NextResponse.json(
            { success: false, error: 'Zahlung wurde noch nicht bestätigt' },
            { status: 409 }
          );
        case 'amount_mismatch':
          // Критический случай: сумма capture не совпала с заказом — заказ
          // НЕ оплачен, алерт уже в логе (см. service).
          return NextResponse.json(
            { success: false, error: 'Zahlungsbetrag stimmt nicht überein' },
            { status: 500 }
          );
        case 'payment_not_found':
        default:
          return NextResponse.json({ success: false, error: 'Payment not found' }, { status: 404 });
      }
    }

    // Финализация (Telegram/печать/лояльность/конверсии) — ровно один раз, тем
    // вызовом, который перевёл заказ в оплаченные. Ошибка финализации не
    // отменяет оплату: логируем критично, отвечаем успехом.
    if (result.shouldFinalize) {
      try {
        const orderDoc = await Order.findById(result.orderId);
        if (orderDoc) await finalizeOrderPlacement(orderDoc, request);
      } catch (error) {
        logPayPalCritical('finalize_failed', {
          order_id: result.orderId,
          source: 'capture',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return NextResponse.json({
      success: true,
      orderId: result.orderId,
      orderNumber: order.orderNumber,
      paymentStatus: result.paymentStatus,
      alreadyPaid: result.alreadyCaptured === true,
      pending: result.pending === true,
    });
  } catch (error) {
    if (error instanceof PayPalApiError) {
      logPayPalError('capture_api_error', { status: error.status, issue: error.issue });
      return NextResponse.json(
        { success: false, error: 'PayPal ist derzeit nicht erreichbar' },
        { status: 502 }
      );
    }
    console.error('PayPal capture error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to capture PayPal order' },
      { status: 500 }
    );
  }
}
