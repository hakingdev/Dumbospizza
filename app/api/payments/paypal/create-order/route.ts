import { NextRequest, NextResponse } from 'next/server';
import { createPayPalOrderForOrder } from '../../../../../lib/paypal/service';
import { getPayPalStore } from '../../../../../lib/paypal/store';
import { canAccessOrder } from '../../../../../lib/paypal/ownership';
import { PayPalApiError } from '../../../../../lib/paypal/client';
import { logPayPalError } from '../../../../../lib/paypal/log';
import { getClientIp, logSecurityEvent, rateLimit } from '../../../../../lib/security/rate-limit';

/**
 * POST /api/payments/paypal/create-order
 * Body: { orderId }
 *
 * Создаёт PayPal Order (Orders v2, intent=CAPTURE) для уже созданного
 * онлайн-заказа. Сумма/валюта считаются ТОЛЬКО на сервере из позиций заказа —
 * любые суммы из тела запроса игнорируются. Доступ только владельцу заказа
 * (HMAC-токен заказа или клиентская сессия). Ответ клиенту — только
 * { paypalOrderId }.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const rl = rateLimit(`paypal-create:${ip}`, 10, 60_000);
    if (!rl.allowed) {
      logSecurityEvent('paypal-create-rate-limited', { ip });
      return NextResponse.json(
        { success: false, error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
      );
    }

    const body = await request.json().catch(() => null);
    const orderId = body?.orderId;
    if (!orderId || typeof orderId !== 'string') {
      return NextResponse.json({ success: false, error: 'orderId is required' }, { status: 400 });
    }

    const store = getPayPalStore();
    const order = await store.getOrderById(orderId);
    if (!order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }
    if (!canAccessOrder(request, order)) {
      logSecurityEvent('paypal-create-forbidden', { ip, orderId });
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const result = await createPayPalOrderForOrder(orderId, store);
    // `=== false` вместо `!ok`: под strict:false только так сужается union
    if (result.ok === false) {
      const map = {
        order_not_found: { status: 404, error: 'Order not found' },
        not_online: { status: 400, error: 'Order is not an online-payment order' },
        already_paid: { status: 409, error: 'Order is already paid' },
        invalid_amount: { status: 500, error: 'Order amount is invalid' },
      } as const;
      const m = map[result.code];
      return NextResponse.json({ success: false, error: m.error }, { status: m.status });
    }

    return NextResponse.json({ success: true, paypalOrderId: result.paypalOrderId });
  } catch (error) {
    if (error instanceof PayPalApiError) {
      logPayPalError('create_order_api_error', { status: error.status, issue: error.issue });
      return NextResponse.json(
        { success: false, error: 'PayPal ist derzeit nicht erreichbar' },
        { status: 502 }
      );
    }
    console.error('PayPal create-order error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create PayPal order' },
      { status: 500 }
    );
  }
}
