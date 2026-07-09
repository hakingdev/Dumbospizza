import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../lib/models';
import { confirmPrintResult } from '../../../../../lib/orders/print-queue';

/**
 * POST /api/orders/[id]/mark-printed
 * Для print-agent: отметить заказ как напечатанный.
 * Заголовок X-Print-Agent-Key должен совпадать с PRINT_AGENT_SECRET в .env.
 *
 * Идемпотентно: повторное подтверждение (ретрай агента после потерянного ответа,
 * повтор после reclaim) ещё раз выставляет тот же терминальный статус — один
 * атомарный UPDATE, без read-then-write.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const key = request.headers.get('X-Print-Agent-Key');
  const secret = process.env.PRINT_AGENT_SECRET;

  if (!secret || key !== secret) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const body = await request.json().catch(() => ({}));
    const printed = body?.success !== false;

    const order = await confirmPrintResult(params.id, printed, {
      agentId: request.headers.get('X-Print-Agent-Id') || undefined,
    });
    if (!order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }
    return NextResponse.json({
      success: true,
      order: { id: order._id, kitchenPrintStatus: order.kitchenPrintStatus }
    });
  } catch (error: any) {
    console.error('Error marking order printed:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
