import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { Order } from '../../../../lib/models/order.model';
import { isStaff, authOptions } from '../../../../lib/auth';
import { getServerSession } from 'next-auth';
import { sendOrderStatusNotification } from '../../../../lib/whatsapp';

interface Params {
  params: {
    id: string;
  };
}

function normalizePhone(value?: string | null) {
  return String(value || '').replace(/[^\d+]/g, '');
}

function canReadOrderByPhone(order: any, phoneNumber?: string | null) {
  return Boolean(phoneNumber) && normalizePhone(order.phoneNumber) === normalizePhone(phoneNumber);
}

// GET /api/orders/[id] - Get a specific order
export async function GET(request: NextRequest, { params }: Params) {
  try {
    await connectToDatabase();
    
    const order = await Order.findById(params.id)
      .populate('user', 'name phoneNumber')
      .exec();
    
    if (!order) {
      return NextResponse.json(
        { success: false, error: 'Order not found' }, 
        { status: 404 }
      );
    }

    const session = await getServerSession(authOptions);
    const phoneNumber = request.nextUrl.searchParams.get('phoneNumber');
    if ((!session || !isStaff(session)) && !canReadOrderByPhone(order, phoneNumber)) {
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
    
    // Update status if provided
    if (status) {
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

    if (status) {
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
