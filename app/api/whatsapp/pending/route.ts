import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, inArray, lt, or } from 'drizzle-orm';
import db from '../../../../lib/db/client';
import { whatsappQueue } from '../../../../lib/db/schema';
import { connectToDatabase } from '../../../../lib/models';
import { getSetting } from '../../../../lib/settings';

/**
 * GET /api/whatsapp/pending
 * Для WhatsApp Web worker: получить pending сообщения. Воркер сам опрашивает сайт (исходящее соединение).
 * Заголовок X-API-Key должен совпадать с WHATSAPP_WEB_WORKER_SECRET (env или storeSettings).
 *
 * ВАЖНО (идемпотентность доставки): сообщения выдаются воркеру АТОМАРНО с
 * переводом в статус 'sending'. Раньше строки оставались 'pending' до тех пор,
 * пока воркер не вызовет /mark-sent, поэтому при следующем опросе (или при
 * перекрытии опросов / медленной отправке / рестарте воркера) одно и то же
 * сообщение выдавалось снова и отправлялось клиенту повторно (дубли 4x).
 * Теперь каждое сообщение выдаётся ровно один раз; повторно — только если воркер
 * «завис» и не подтвердил отправку дольше CLAIM_STALE_MS (тогда строка повторно
 * становится доступной для доставки).
 */

// Сколько ждать подтверждения (/mark-sent) от воркера, прежде чем считать выдачу
// «зависшей» и снова разрешить доставку сообщения (на случай падения воркера).
const CLAIM_STALE_MS = 2 * 60 * 1000;
const BATCH_SIZE = 50;

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

    const now = new Date();
    const staleBefore = new Date(now.getTime() - CLAIM_STALE_MS);

    // Кандидаты на выдачу: новые ('pending') и «зависшие» ('sending', выданные
    // давно, но так и не подтверждённые воркером).
    const eligible = or(
      eq(whatsappQueue.status, 'pending'),
      and(eq(whatsappQueue.status, 'sending'), lt(whatsappQueue.sentAt, staleBefore))
    );

    const candidates = await db
      .select({ id: whatsappQueue.id })
      .from(whatsappQueue)
      .where(eligible)
      .orderBy(asc(whatsappQueue.createdAt))
      .limit(BATCH_SIZE);

    if (candidates.length === 0) {
      return NextResponse.json({ success: true, items: [] });
    }

    const candidateIds = candidates.map((c) => c.id);

    // Атомарная «заявка»: одним UPDATE ... RETURNING переводим строки в 'sending'
    // и возвращаем только те, что были реально захвачены этим запросом. Повторное
    // условие eligible внутри WHERE защищает от гонки параллельных опросов — второй
    // запрос не получит уже захваченные строки.
    const claimed = await db
      .update(whatsappQueue)
      .set({ status: 'sending', sentAt: now, updatedAt: now })
      .where(and(inArray(whatsappQueue.id, candidateIds), eligible))
      .returning({
        id: whatsappQueue.id,
        phone: whatsappQueue.phone,
        text: whatsappQueue.text,
        orderId: whatsappQueue.orderId,
      });

    if (claimed.length > 0) {
      console.info(
        '[whatsapp/pending] claimed for delivery',
        JSON.stringify({
          count: claimed.length,
          ids: claimed.map((it) => it.id),
          orderIds: claimed.map((it) => it.orderId).filter(Boolean),
        })
      );
    }

    return NextResponse.json({
      success: true,
      items: claimed.map((it) => ({
        id: it.id,
        phone: it.phone,
        text: it.text,
      })),
    });
  } catch (error: any) {
    console.error('Error fetching WhatsApp pending:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
