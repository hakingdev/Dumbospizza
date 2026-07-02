import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { Order } from '../../../../lib/models/order.model';
import { User } from '../../../../lib/models/user.model';
import { isStaff, authOptions } from '../../../../lib/auth';
import { getServerSession } from 'next-auth';
import { getCustomerSession } from '../../../../lib/customer-auth';
import { verifyOrderAccessToken } from '../../../../lib/orders/access-token';
import { rateLimit, getClientIp, logSecurityEvent } from '../../../../lib/security/rate-limit';
import { sendOrderStatusNotification } from '../../../../lib/whatsapp';
import { earnForCompletedOrder, reverseOrder } from '../../../../lib/loyalty/service';

interface Params {
  params: {
    id: string;
  };
}

function normalizePhone(value?: string | null) {
  return String(value || '').replace(/[^\d+]/g, '');
}

/**
 * Владелец заказа через клиентскую cookie-сессию (/account): userId берётся из
 * подписанного cookie (не из запроса). Легаси-заказы без user привязываем по
 * совпадению телефона аккаунта с телефоном заказа.
 */
async function isCustomerOwner(request: NextRequest, order: any): Promise<boolean> {
  const customer = getCustomerSession(request);
  if (!customer) return false;
  if (order.user && String(order.user) === customer.userId) return true;
  const user = await User.findById(customer.userId);
  return Boolean(
    user && normalizePhone(user.phoneNumber) === normalizePhone(order.phoneNumber)
  );
}

// GET /api/orders/[id] - Get a specific order
export async function GET(request: NextRequest, { params }: Params) {
  try {
    await connectToDatabase();

    const session = await getServerSession(authOptions);
    const isStaffUser = Boolean(session && isStaff(session));

    // Rate-limit только неперсонал: перебор orderId/токена. Персонал (админка)
    // делает легитимно много запросов и лимиту не подлежит.
    if (!isStaffUser) {
      const ip = getClientIp(request);
      const rl = rateLimit(`order-get:${ip}`, 30, 60_000);
      if (!rl.allowed) {
        logSecurityEvent('order-get-rate-limited', { ip, orderId: params.id });
        return NextResponse.json(
          { success: false, error: 'Too many requests' },
          { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
        );
      }
    }

    const order = await Order.findById(params.id)
      .populate('user', 'name phoneNumber')
      .exec();

    if (!order) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    // Доступ: персонал (сессия) ИЛИ владелец-клиент (cookie) ИЛИ валидный
    // подписанный токен заказа. Номер телефона больше НЕ является ключом доступа.
    const token = request.nextUrl.searchParams.get('token');
    const authorized =
      isStaffUser ||
      verifyOrderAccessToken(params.id, token) ||
      (await isCustomerOwner(request, order));

    if (!authorized) {
      logSecurityEvent('order-get-denied', {
        ip: getClientIp(request),
        orderId: params.id,
        hadToken: Boolean(token),
      });
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    return NextResponse.json({ success: true, order });
  } catch (error: any) {
    console.error('Error fetching order:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

// PUT /api/orders/[id] - Update order status (staff only)
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    await connectToDatabase();
    
    // Verify staff authentication
    const session = await getServerSession(authOptions);
    if (!session || !isStaff(session)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Unauthorized' 
      }, { status: 401 });
    }
    
    const data = await request.json();
    const { status, notes, kitchenPrintStatus, customerPrintStatus } = data;

    // Get the current order
    const order = await Order.findById(params.id);

    if (!order) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    const previousStatus = order.status;

    const statusChanged = Boolean(status && status !== previousStatus);

    // Update status if provided and actually changed. Re-sending the same
    // status should be idempotent: no duplicate history or WhatsApp message.
    if (statusChanged) {
      order.status = status;
      
      // Add status update to history
      order.statusUpdates = order.statusUpdates || [];
      order.statusUpdates.push({
        status,
        timestamp: new Date(),
        updatedBy: (session.user as { id?: string })?.id || session.user?.email || session.user?.name || 'system'
      });
    }
    
    // Update other fields if provided
    if (notes !== undefined) {
      order.notes = notes;
    }
    
    if (kitchenPrintStatus) {
      order.kitchenPrintStatus = kitchenPrintStatus;
    }
    
    if (customerPrintStatus) {
      order.customerPrintStatus = customerPrintStatus;
    }
    
    // Save updates
    await order.save();

    // Бонусы лояльности по переходу статуса (не валим ответ при ошибке):
    //  - completed: начислить баллы (идемпотентно);
    //  - cancelled: реверс начисления + возврат списанных баллов.
    if (statusChanged) {
      if (status === 'completed') {
        await earnForCompletedOrder(order).catch((e) =>
          console.error('Loyalty earn on completion:', e)
        );
      } else if (status === 'cancelled') {
        await reverseOrder(order).catch((e) =>
          console.error('Loyalty reverse on cancel:', e)
        );
      }
    }

    if (statusChanged) {
      sendOrderStatusNotification(
        { phoneNumber: order.phoneNumber, orderNumber: order.orderNumber },
        status
      ).catch((e) => console.error('WhatsApp status notification:', e));
    }

    return NextResponse.json({ success: true, order });
  } catch (error: any) {
    console.error('Error updating order:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
