import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../lib/models';
import { Order } from '../../../../../lib/models/order.model';
import { createSumUpCheckout } from '../../../../../lib/sumup';

/**
 * POST /api/payments/sumup/checkout
 * Body: { orderId }
 * Создаёт SumUp checkout для уже созданного онлайн-заказа и возвращает checkoutId
 * для монтирования платёжного виджета на клиенте. Сумма берётся с сервера (order.total),
 * не с клиента.
 */
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();

    const { orderId } = await request.json();
    if (!orderId) {
      return NextResponse.json({ success: false, error: 'orderId is required' }, { status: 400 });
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

    if (order.paymentStatus === 'completed') {
      return NextResponse.json({ success: false, error: 'Order is already paid' }, { status: 409 });
    }

    const checkout = await createSumUpCheckout({
      reference: order.orderNumber,
      amount: order.total,
      currency: 'EUR',
      description: `Dumbo Pizza Bestellung #${order.orderNumber}`,
    });

    return NextResponse.json({
      success: true,
      checkoutId: checkout.id,
      amount: order.total,
      currency: checkout.currency || 'EUR',
    });
  } catch (error: any) {
    console.error('SumUp create checkout error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to create checkout' },
      { status: 500 }
    );
  }
}
