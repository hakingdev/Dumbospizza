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

    // Атомарно помечаем оплаченным ДО финализации: при двух одновременных
    // confirm-запросах только один запустит побочные эффекты.
    const claimedOrder = await Order.findOneAndUpdate(
      { _id: orderId, paymentStatus: 'pending' },
      { $set: { paymentStatus: 'completed' } }
    );

    if (!claimedOrder) {
      const latestOrder = await Order.findById(orderId);
      if (latestOrder?.paymentStatus === 'completed') {
        return NextResponse.json({
          success: true,
          alreadyPaid: true,
          order: {
            id: latestOrder._id.toString(),
            orderNumber: latestOrder.orderNumber,
            loyaltyPointsEarned: latestOrder.loyaltyPointsEarned || 0,
          },
        });
      }

      return NextResponse.json(
        { success: false, error: 'Payment status changed before confirmation' },
        { status: 409 }
      );
    }

    await finalizeOrderPlacement(claimedOrder, request);

    return NextResponse.json({
      success: true,
      order: {
        id: claimedOrder._id.toString(),
        orderNumber: claimedOrder.orderNumber,
        loyaltyPointsEarned: claimedOrder.loyaltyPointsEarned || 0,
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
