import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { WhatsAppQueue } from '../../../../lib/models/whatsapp-queue.model';
import { getSetting } from '../../../../lib/settings';

/**
 * GET /api/whatsapp/pending
 * Для WhatsApp Web worker: получить pending сообщения. Воркер сам опрашивает сайт (исходящее соединение).
 * Заголовок X-API-Key должен совпадать с WHATSAPP_WEB_WORKER_SECRET (env или storeSettings).
 */
export async function GET(request: NextRequest) {
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
    await connectToDatabase();
    const items = await WhatsAppQueue.find({ status: 'pending' })
      .sort({ createdAt: 1 })
      .limit(50)
      .lean();
    return NextResponse.json({
      success: true,
      items: items.map((it) => ({
        id: (it as any)._id.toString(),
        phone: it.phone,
        text: it.text
      }))
    });
  } catch (error: any) {
    console.error('Error fetching WhatsApp pending:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
