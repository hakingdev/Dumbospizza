import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { User } from '../../../../lib/models/user.model';
import { Order } from '../../../../lib/models/order.model';
import { getCustomerSession } from '../../../../lib/customer-auth';

// GET /api/customer/orders — заказы текущего клиента (по cookie-сессии)
// user_id берётся из cookie, не из запроса → клиент видит только свои заказы.
export async function GET(request: NextRequest) {
  const session = getCustomerSession(request);
  if (!session) {
    return NextResponse.json({ success: false, error: 'Nicht angemeldet' }, { status: 401 });
  }
  try {
    await connectToDatabase();
    const user = await User.findById(session.userId);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Nicht gefunden' }, { status: 404 });
    }

    const { searchParams } = request.nextUrl;
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50);
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const skip = (page - 1) * limit;

    // Заказы по userId ИЛИ по номеру телефона клиента (старые заказы без user).
    const query = { $or: [{ user: session.userId }, { phoneNumber: user.phoneNumber }] };

    const orders = await Order.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit);
    const total = await Order.countDocuments(query);

    const view = orders.map((o: any) => ({
      id: o._id.toString(),
      orderNumber: o.orderNumber,
      status: o.status,
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod,
      deliveryType: o.deliveryType,
      deliveryAddress: o.deliveryAddress || null,
      items: o.items,
      subtotal: o.subtotal,
      deliveryFee: o.deliveryFee,
      total: o.total,
      loyaltyPointsUsed: o.loyaltyPointsUsed || 0,
      loyaltyPointsEarned: o.loyaltyPointsEarned || 0,
      createdAt: o.createdAt,
    }));

    return NextResponse.json({
      success: true,
      orders: view,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (error: any) {
    console.error('customer/orders GET:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
