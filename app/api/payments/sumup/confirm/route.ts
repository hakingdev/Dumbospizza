import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../lib/models';
import { Order } from '../../../../../lib/models/order.model';
import { getSumUpCheckout, isSumUpCheckoutPaid } from '../../../../../lib/sumup';
import { finalizeOrderPlacement } from '../../../../../lib/orders/finalize';

/**
 * POST /api/payments/sumup/confirm
 * Body: { orderId, checkoutId }
 *
 * Серверная проверка оплаты SumUp (источник истины — не колбэк виджета).
 * При статусе PAID помечает заказ оплаченным и запускает финализацию
 * (Telegram/печать/лояльность/конверсии). Идемпотентна: повторный вызов на уже
 * оплаченном заказе просто возвращает success без повторных побочных эффектов.
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

    // Идемпотентность: уже оплачен и финализирован — ничего не делаем повторно.
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

    if (!isSumUpCheckoutPaid(checkout, { reference: order.orderNumber, amount: order.total })) {
      return NextResponse.json(
        { success: false, error: 'Payment not completed', status: checkout.status },
        { status: 402 }
      );
    }

    // Помечаем оплаченным ДО финализации — это гейт идемпотентности и условие
    // допуска заказа к печати (см. GET /api/orders гейт по paymentStatus).
    order.paymentStatus = 'completed';
    await order.save();

    await finalizeOrderPlacement(order, request);

    return NextResponse.json({
      success: true,
      order: {
        id: order._id.toString(),
        orderNumber: order.orderNumber,
        loyaltyPointsEarned: order.loyaltyPointsEarned || 0,
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
