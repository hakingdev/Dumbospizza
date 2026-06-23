import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../lib/models';
import { Order } from '../../../../../lib/models/order.model';
import { createSumUpCheckout } from '../../../../../lib/sumup';
import { buildSumUpCheckoutDescription } from '../../../../../lib/orders/tax';

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

    // Чек SumUp формируется из единственного текстового поля description.
    // Передаём в него реальные позиции (Artikel) и разбивку налогов (USt. 7 % /
    // 19 %), а не одну общую строку. VAT применяется только к онлайн-заказам —
    // этот маршрут вызывается исключительно для paymentMethod === 'online'.
    const checkout = await createSumUpCheckout({
      reference: order.orderNumber,
      amount: order.total,
      currency: 'EUR',
      description: buildSumUpCheckoutDescription({
        orderNumber: order.orderNumber,
        items: order.items,
        paymentMethod: order.paymentMethod,
      }),
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
