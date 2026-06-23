import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { WhatsAppQueue } from '../../../../lib/models/whatsapp-queue.model';
import { getSetting } from '../../../../lib/settings';

/**
 * POST /api/whatsapp/mark-sent
 * Для WhatsApp Web worker: отметить сообщение отправленным или failed.
 * Заголовок X-API-Key = WHATSAPP_WEB_WORKER_SECRET.
 * Body: { id: string, success: boolean, error?: string }
 */
export async function POST(request: NextRequest) {
  const key = request.headers.get('X-API-Key');
  let secret = process.env.WHATSAPP_WEB_WORKER_SECRET?.trim();
  if (!secret) {
    await connectToDatabase();
    const storeSettings = await getSetting<Record<string, any>>('storeSettings', {});
    secret = (storeSettings?.whatsappWebWorkerSecret as string)?.trim();
  }

  if (!secret || key !== secret) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, success, error } = body;
    if (!id || typeof success !== 'boolean') {
      return NextResponse.json({ success: false, error: 'Missing id or success' }, { status: 400 });
    }

    await connectToDatabase();
    const item = await WhatsAppQueue.findById(id);
    if (!item) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    // Идемпотентность: финальный статус выставляем только один раз. Повторный
    // /mark-sent на уже отправленном сообщении (повтор воркера) ничего не меняет.
    if (item.status === 'sent') {
      console.info(
        '[whatsapp/mark-sent] skip — already sent',
        JSON.stringify({ id, orderId: item.orderId })
      );
      return NextResponse.json({ success: true, alreadyMarked: true });
    }

    item.status = success ? 'sent' : 'failed';
    item.sentAt = new Date();
    if (error) item.error = error;
    await item.save();
    console.info(
      '[whatsapp/mark-sent] marked',
      JSON.stringify({ id, orderId: item.orderId, status: item.status })
    );
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error marking WhatsApp sent:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
