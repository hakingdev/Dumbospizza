import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../lib/models';
import { Order } from '../../../../../lib/models/order.model';
import { getSumUpCheckout, SumUpApiError } from '../../../../../lib/sumup';
import {
  applySumUpCheckoutStatus,
  extractSumUpCheckoutId,
} from '../../../../../lib/orders/payment-draft';
import { finalizeOrderPlacement } from '../../../../../lib/orders/finalize';
import { getClientIp, logSecurityEvent, rateLimit } from '../../../../../lib/security/rate-limit';

/**
 * POST /api/payments/sumup/webhook — CHECKOUT_STATUS_CHANGED от SumUp.
 *
 * Телу вебхука НЕ доверяем (SumUp не подписывает payment-вебхуки): из body
 * берётся ТОЛЬКО id checkout'а, состояние всегда перепроверяется серверным
 * GET /v0.1/checkouts/{id}. Заказ находится по checkout_reference (orders.id),
 * сумма сверяется с заказом. Поэтому поддельный вебхук в худшем случае
 * триггерит лишнюю верификацию, но не может ни создать, ни оплатить заказ.
 *
 *  - PAID → идемпотентный промоут драфта в «Новый» (номер, финализация) —
 *    общий guarded UPDATE с /confirm и PayPal, дубли невозможны;
 *  - FAILED / EXPIRED → драфт помечается неуспешным, в «Заказы» ничего
 *    не попадает;
 *  - PENDING / неизвестный заказ → no-op (200).
 *
 * Ответы: 2xx — обработано/устойчивый no-op; 400 — мусорное тело; 503 —
 * временный сбой верификации (SumUp ретраит доставку).
 */

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimit(`sumup-webhook:${ip}`, 60, 60_000);
  if (!rl.allowed) {
    logSecurityEvent('sumup-webhook-rate-limited', { ip });
    return NextResponse.json(
      { received: false },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    );
  }

  const body = await request.json().catch(() => null);
  const checkoutId = extractSumUpCheckoutId(body);
  if (!checkoutId) {
    logSecurityEvent('sumup-webhook-invalid-body', { ip });
    return NextResponse.json({ received: false }, { status: 400 });
  }

  const eventType = (body as Record<string, any>)?.event_type;
  console.log(`[payment-draft] webhook_received checkout=${checkoutId} event=${eventType || '?'}`);

  try {
    await connectToDatabase();

    // Единственный источник истины — серверный GET состояния checkout.
    let checkout;
    try {
      checkout = await getSumUpCheckout(checkoutId);
    } catch (error) {
      if (error instanceof SumUpApiError && error.status === 404) {
        // Неизвестный/чужой checkout id: ретраить бессмысленно.
        logSecurityEvent('sumup-webhook-unknown-checkout', { ip, checkoutId });
        return NextResponse.json({ received: true, handled: false });
      }
      // Временный сбой (сеть/5xx SumUp) — 503, SumUp повторит доставку.
      console.error(`[payment-draft] webhook_verify_unavailable checkout=${checkoutId}:`, error);
      return NextResponse.json({ received: false }, { status: 503 });
    }

    const result = await applySumUpCheckoutStatus(checkout, {
      finalize: async (orderRow) => {
        const orderDoc = await Order.findById(orderRow.id);
        if (orderDoc) await finalizeOrderPlacement(orderDoc, request);
      },
    });

    return NextResponse.json({ received: true, outcome: result.outcome });
  } catch (error) {
    console.error(`[payment-draft] webhook_processing_failed checkout=${checkoutId}:`, error);
    return NextResponse.json({ received: false }, { status: 500 });
  }
}

/** Health-check для настройки вебхука в кабинете SumUp. */
export async function GET() {
  return NextResponse.json({ ok: true });
}
