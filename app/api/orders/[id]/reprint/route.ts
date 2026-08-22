import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { connectToDatabase } from '../../../../../lib/models';
import { isStaff, authOptions } from '../../../../../lib/auth';
import { authorizePos } from '../../../../../lib/pos/auth';
import { requestKitchenReprint } from '../../../../../lib/orders/print-queue';

/**
 * POST /api/orders/[id]/reprint
 * Кнопка «Напечатать ещё раз» в админке: ставит кухонный чек заказа обратно в
 * очередь принт-агента как НОВОЕ задание печати (kitchenPrintSeq + 1).
 *
 * Только для персонала. Сам чек печатает агент на кассовом ПК — ответ 200
 * означает «поставлено в очередь», а не «бумага вышла»: агент заберёт заказ
 * на ближайшем тике опроса (по умолчанию раз в 5 с).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Персонал по сессии ИЛИ прибор по ключу X-Pos-Key: повтор бона просит и
  // нативный терминал. В журнал печати пишем, кто именно попросил.
  const session = await getServerSession(authOptions);
  let requestedBy = (session?.user as any)?.email || (session?.user as any)?.name || '';
  if (!session || !isStaff(session)) {
    const device = await authorizePos(request);
    if (!device.ok) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    requestedBy = `pos:${request.headers.get('x-pos-device') || 'device'}`;
  }

  try {
    await connectToDatabase();

    const order = await requestKitchenReprint(params.id, {
      requestedBy: requestedBy || 'staff',
    });

    if (!order) {
      // Либо заказа нет, либо он непечатаемый: драфт оплаты / неоплаченный
      // онлайн-заказ. Такой в очередь ставить нельзя — агент его не заберёт.
      return NextResponse.json(
        {
          success: false,
          error: 'Заказ не найден или не может быть напечатан (не подтверждена оплата)',
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      order: {
        id: order._id,
        orderNumber: order.orderNumber,
        kitchenPrintStatus: order.kitchenPrintStatus,
        kitchenPrintSeq: order.kitchenPrintSeq,
      },
    });
  } catch (error: any) {
    console.error('Error requesting reprint:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
