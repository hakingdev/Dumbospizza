import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { Promotion } from '../../../../lib/models/promotion.model';

/** POST — аналитика: view | modal_open | click | order */
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const body = await request.json();
    const { promotionId, event, revenue } = body as {
      promotionId?: string;
      event?: string;
      revenue?: number;
    };

    if (!promotionId || !event) {
      return NextResponse.json({ success: false, error: 'promotionId and event required' }, { status: 400 });
    }

    const inc: Record<string, number> = {};
    switch (event) {
      case 'view':
        inc.viewCount = 1;
        break;
      case 'modal_open':
        inc.modalOpenCount = 1;
        break;
      case 'click':
        inc.clickCount = 1;
        break;
      case 'order':
        inc.orderCount = 1;
        inc.usageCount = 1;
        if (typeof revenue === 'number' && revenue > 0) inc.revenueTotal = revenue;
        break;
      default:
        return NextResponse.json({ success: false, error: 'Invalid event' }, { status: 400 });
    }

    await Promotion.findByIdAndUpdate(promotionId, { $inc: inc });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('POST /api/promotions/analytics', error);
    return NextResponse.json({ success: false, error: 'Analytics failed' }, { status: 500 });
  }
}
