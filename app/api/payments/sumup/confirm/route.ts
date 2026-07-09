import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../lib/models';
import { Order } from '../../../../../lib/models/order.model';
import { getSumUpCheckout, isSumUpCheckoutPaid } from '../../../../../lib/sumup';
import { finalizeOrderPlacement } from '../../../../../lib/orders/finalize';
import { claimOrderPaidAndPromote } from '../../../../../lib/orders/payment-draft';

/**
 * POST /api/payments/sumup/confirm
 * Body: { orderId, checkoutId }
 *
 * Серверная проверка оплаты SumUp на return/success-колбэке клиента (источник
 * истины — GET /v0.1/checkouts/{id}, никогда не колбэк виджета). При статусе
 * PAID идемпотентно промоутит драфт (pending_payment → «Новый» + номер) и
 * запускает финализацию (Telegram/печать/лояльность/конверсии).
 *
 * Идемпотентно и гонко-безопасно с вебхуком CHECKOUT_STATUS_CHANGED: оба пути
 * сходятся в claimOrderPaidAndPromote (один guarded UPDATE по заказу) — промоут
 * и финализация случаются строго один раз, повторный вызов возвращает success
 * без повторных побочных эффектов.
 */
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();

    const { orderId, checkoutId } = await request.json();
    if (!orderId || !checkoutId) {
      return NextResponse.json(
        { success: false, error: 'orderId and checkoutId are required' },
        { status: 400 }
      );
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    if (order.paymentMethod !== 'online') {
      return NextResponse.json(
        { success: false, error: 'Order is not an online-payment order' },
        { status: 400 }
      );
    }

    // Идемпотентность: уже оплачен и промоучен (вебхук успел раньше) —
    // ничего не делаем повторно.
    if (order.paymentStatus === 'completed') {
      return NextResponse.json({
        success: true,
        alreadyPaid: true,
        order: {
          id: order._id.toString(),
          orderNumber: order.orderNumber,
          loyaltyPointsEarned: order.loyaltyPointsEarned || 0,
        },
      });
    }

    const checkout = await getSumUpCheckout(checkoutId);

    if (
      !isSumUpCheckoutPaid(checkout, {
        // reference = orders.id (новая схема); orderNumber — легаси-checkout'ы,
        // созданные до перехода.
        references: [order._id.toString(), order.orderNumber],
        amount: order.total,
      })
    ) {
      console.log(
        `[payment-draft] confirm_not_paid order=${order._id} checkout=${checkout.id} status=${checkout.status}`
      );
      return NextResponse.json(
        { success: false, error: 'Payment not completed', status: checkout.status },
        { status: 402 }
      );
    }

    // Атомарный промоут (payment_status → completed, pending_payment → new,
    // нумерация): при одновременных confirm/вебхуке ровно один запускает
    // побочные эффекты.
    const result = await claimOrderPaidAndPromote(order._id.toString());

    if (!result.claimed) {
      if (result.alreadyPaid && result.order) {
        return NextResponse.json({
          success: true,
          alreadyPaid: true,
          order: {
            id: result.order.id,
            orderNumber: result.order.orderNumber,
            loyaltyPointsEarned: result.order.loyaltyPointsEarned || 0,
          },
        });
      }

      return NextResponse.json(
        { success: false, error: 'Payment status changed before confirmation' },
        { status: 409 }
      );
    }

    // Финализация — best-effort: оплата уже зафиксирована, её ошибка не должна
    // отменять успех подтверждения (печать доберёт очередь принт-агента).
    try {
      const claimedOrder = await Order.findById(orderId);
      if (claimedOrder) await finalizeOrderPlacement(claimedOrder, request);
    } catch (error) {
      console.error(
        `[payment-draft] finalize_failed order=${orderId} source=confirm:`,
        error
      );
    }

    return NextResponse.json({
      success: true,
      order: {
        id: result.order?.id || order._id.toString(),
        orderNumber: result.order?.orderNumber || order.orderNumber,
        loyaltyPointsEarned: result.order?.loyaltyPointsEarned || 0,
      },
    });
  } catch (error: any) {
    console.error('SumUp confirm error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to confirm payment' },
      { status: 500 }
    );
  }
}
