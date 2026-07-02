import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { Order } from '../../../../lib/models/order.model';
import { User } from '../../../../lib/models/user.model';
import { getCustomerSession, normalizePhone } from '../../../../lib/customer-auth';
import { verifyOrderAccessToken } from '../../../../lib/orders/access-token';

// POST /api/orders/repeat - Функция для повторения заказа
// Ответ содержит PII (адрес, имя, телефон, email). Авторизация: cookie-сессия
// клиента (владелец) ИЛИ подписанный токен заказа. Номер телефона из тела запроса
// ключом доступа больше НЕ является (иначе IDOR: orderId+чужой телефон → адрес).
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();

    const data = await request.json();
    const { orderId, token } = data;

    if (!orderId) {
      return NextResponse.json({
        success: false,
        error: 'Order ID is required'
      }, { status: 400 });
    }

    // Найти оригинальный заказ
    const originalOrder = await Order.findById(orderId);

    if (!originalOrder) {
      return NextResponse.json({
        success: false,
        error: 'Order not found'
      }, { status: 404 });
    }

    // Проверка владения: сессия клиента (user_id из cookie) или подписанный токен.
    const session = getCustomerSession(request);
    let authorized = verifyOrderAccessToken(orderId, token);
    if (!authorized && session) {
      const user = await User.findById(session.userId);
      authorized = Boolean(
        user &&
          (String(originalOrder.user || '') === session.userId ||
            normalizePhone(originalOrder.phoneNumber) === normalizePhone(user.phoneNumber))
      );
    }

    if (!authorized) {
      return NextResponse.json({
        success: false,
        error: 'Unauthorized'
      }, { status: 401 });
    }
    
    // Извлекаем только необходимые данные для повторного заказа
    const repeatOrderData = {
      items: originalOrder.items.map(item => ({
        name: item.name,
        price: item.price,
        basePrice: item.basePrice,
        quantity: item.quantity,
        image: item.image,
        size: item.size,
        extras: item.extras,
        options: item.options,
        notes: item.notes
      })),
      customerName: originalOrder.customerName,
      phoneNumber: originalOrder.phoneNumber,
      email: originalOrder.email,
      deliveryType: originalOrder.deliveryType,
      deliveryAddress: originalOrder.deliveryAddress,
      deliveryZone: originalOrder.deliveryZone,
      subtotal: originalOrder.subtotal,
      tax: 0,
      deliveryFee: originalOrder.deliveryFee,
      total: originalOrder.total
    };
    
    return NextResponse.json({
      success: true,
      orderData: repeatOrderData
    });
  } catch (error: any) {
    console.error('Error repeating order:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
