import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { connectToDatabase } from '../../../../../lib/models';
import { isStaff, authOptions } from '../../../../../lib/auth';
import { applyOrderDelay, isValidDelayMinutes } from '../../../../../lib/orders/delay';

export const dynamic = 'force-dynamic';

/**
 * POST /api/orders/[id]/delay — кнопка «Заказ опаздывает на +N мин» в панели
 * AI-плана кухни. Тело: { delayMinutes: number } (целые 5…60).
 *
 * Сдвигает обещанное время (etaMinutes/etaSetAt) и отправляет гостю WhatsApp
 * на немецком через Twilio («Leider verzögert sich Ihre Bestellung …»).
 * whatsappSent=false в ответе — время сдвинуто, но сообщение не ушло
 * (нет телефона на заказе / Twilio не настроен / уведомления выключены).
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || !isStaff(session)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await connectToDatabase();

    const body = await request.json().catch(() => ({}));
    const delayMinutes = Number(body?.delayMinutes);
    if (!isValidDelayMinutes(delayMinutes)) {
      return NextResponse.json(
        { success: false, error: 'delayMinutes: целое число минут от 5 до 60' },
        { status: 400 }
      );
    }

    const result = await applyOrderDelay(params.id, delayMinutes);
    if (!result.ok) {
      const status = result.reason === 'not_found' ? 404 : 500;
      return NextResponse.json(
        { success: false, error: result.reason === 'not_found' ? 'Заказ не найден' : 'Не удалось применить задержку' },
        { status }
      );
    }

    return NextResponse.json({
      success: true,
      orderNumber: result.orderNumber,
      etaMinutes: result.etaMinutes,
      whatsappSent: result.whatsappSent,
    });
  } catch (error: any) {
    console.error('Error applying order delay:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
