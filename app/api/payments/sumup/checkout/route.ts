import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../lib/models';
import { Order } from '../../../../../lib/models/order.model';
import { createSumUpCheckout, listSumUpCheckoutsByReference } from '../../../../../lib/sumup';
import { buildSumUpCheckoutDescription } from '../../../../../lib/orders/tax';
import { SITE_URL } from '../../../../../lib/site-url';

/**
 * POST /api/payments/sumup/checkout
 * Body: { orderId }
 * Создаёт (или переиспользует) SumUp checkout для онлайн-заказа-драфта и
 * возвращает checkoutId для монтирования платёжного виджета. Сумма берётся
 * с сервера (order.total), не с клиента.
 *
 * checkout_reference = orders.id — стабильный ключ идемпотентности заказа:
 * повторное открытие виджета/ретрай переиспользует существующий PENDING
 * checkout с той же суммой вместо создания дубля, а вебхук/confirm по
 * reference однозначно находят заказ.
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

    const reference = String(order._id);

    // Идемпотентность на стороне SumUp: существующий PENDING checkout с той же
    // суммой переиспользуем (SumUp и сам отклоняет второй checkout с тем же
    // reference — DUPLICATED_CHECKOUT).
    let checkout = null as Awaited<ReturnType<typeof createSumUpCheckout>> | null;
    try {
      const existing = await listSumUpCheckoutsByReference(reference);
      checkout =
        existing.find(
          (c) => c.status === 'PENDING' && Math.abs(c.amount - order.total) <= 0.01
        ) || null;
      if (checkout) {
        console.log(
          `[payment-draft] checkout_reused order=${reference} checkout=${checkout.id} amount=${checkout.amount}`
        );
      }
    } catch (listError) {
      // Листинг — оптимизация; при сбое просто создаём новый checkout.
      console.error('SumUp list checkouts error:', listError);
    }

    if (!checkout) {
      // Чек SumUp формируется из единственного текстового поля description.
      // Передаём в него реальные позиции (Artikel) и разбивку налогов (USt. 7 % /
      // 19 %), а не одну общую строку. У драфта номера ещё нет (нумерация — при
      // промоуте после оплаты) — в заголовок идёт reference.
      checkout = await createSumUpCheckout({
        reference,
        amount: order.total,
        currency: 'EUR',
        description: buildSumUpCheckoutDescription({
          orderNumber: order.orderNumber || reference,
          items: order.items,
          paymentMethod: order.paymentMethod,
        }),
        // APM-флоу (redirect) требуют redirect_url при создании checkout (дока
        // SumUp); карте/кошелькам не мешает. Возврат — на страницу подтверждения;
        // промоут заказа при этом делает вебхук/confirm, не редирект.
        redirectUrl: `${SITE_URL}/checkout/confirmation/${reference}`,
        // Бэкенд-колбэк SumUp (CHECKOUT_STATUS_CHANGED): задаётся здесь на
        // каждый checkout — в кабинете SumUp ничего регистрировать не нужно.
        // SITE_URL канонично www (apex отдал бы 308 и колбэк бы терялся).
        returnUrl: `${SITE_URL}/api/payments/sumup/webhook`,
      });
      console.log(
        `[payment-draft] checkout_created order=${reference} checkout=${checkout.id} amount=${order.total}`
      );
    }

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
