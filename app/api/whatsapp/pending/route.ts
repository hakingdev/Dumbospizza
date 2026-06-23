import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, gte, inArray, lt, ne, or } from 'drizzle-orm';
import db from '../../../../lib/db/client';
import { whatsappQueue } from '../../../../lib/db/schema';
import { connectToDatabase } from '../../../../lib/models';
import { getSetting } from '../../../../lib/settings';
import { dedupKey, planDelivery } from '../../../../lib/whatsapp-delivery';

/**
 * GET /api/whatsapp/pending
 * Для WhatsApp Web worker: получить pending сообщения. Воркер сам опрашивает сайт (исходящее соединение).
 * Заголовок X-API-Key должен совпадать с WHATSAPP_WEB_WORKER_SECRET (env или storeSettings).
 *
 * ИДЕМПОТЕНТНОСТЬ ДОСТАВКИ (серверный обход, скрипт воркера НЕ трогаем):
 * воркер на рабочей машине может опросить сайт повторно / отправить одно и то же
 * сообщение дважды — управлять им мы не можем. Единственный серверный рычаг — что
 * именно эндпоинт ОТДАЁТ воркеру. Поэтому гарантируется, что одно и то же
 * сообщение (одинаковые orderId+text) выдаётся воркеру максимум ОДИН РАЗ за всё
 * время:
 *   1) выдача атомарна (pending -> 'sending') — повторный опрос не увидит строку;
 *   2) если идентичное сообщение уже 'sent' или прямо сейчас 'sending' (in-flight),
 *      все дубликаты помечаются 'skipped' и НИКОГДА не отправляются;
 *   3) если в очереди несколько дублей разом — выдаётся только самый старый,
 *      остальные -> 'skipped'.
 * Повторная выдача одной строки возможна лишь если воркер «завис» и не подтвердил
 * отправку дольше CLAIM_STALE_MS (тогда at-least-once после падения воркера).
 */

// Сколько ждать подтверждения (/mark-sent), прежде чем считать выдачу зависшей.
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

    // Кандидаты на выдачу: новые ('pending') и зависшие ('sending', выданные
    // давно и не подтверждённые воркером). Старые — первыми.
    const eligible = or(
      eq(whatsappQueue.status, 'pending'),
      and(eq(whatsappQueue.status, 'sending'), lt(whatsappQueue.sentAt, staleBefore))
    );

    const candidates = await db
      .select({
        id: whatsappQueue.id,
        phone: whatsappQueue.phone,
        text: whatsappQueue.text,
        orderId: whatsappQueue.orderId,
      })
      .from(whatsappQueue)
      .where(eligible)
      .orderBy(asc(whatsappQueue.createdAt))
      .limit(BATCH_SIZE);

    if (candidates.length === 0) {
      return NextResponse.json({ success: true, items: [] });
    }

    // Уже доставленные / прямо сейчас отправляемые идентичные сообщения: их ключи
    // нельзя выдавать повторно. Берём по orderId кандидатов (узкая выборка).
    const candidateOrderIds = Array.from(
      new Set(candidates.map((c) => c.orderId).filter((v): v is string => !!v))
    );
    const occupiedKeys = new Set<string>();
    if (candidateOrderIds.length > 0) {
      const occupiedRows = await db
        .select({
          phone: whatsappQueue.phone,
          text: whatsappQueue.text,
          orderId: whatsappQueue.orderId,
        })
        .from(whatsappQueue)
        .where(
          and(
            inArray(whatsappQueue.orderId, candidateOrderIds),
            or(
              eq(whatsappQueue.status, 'sent'),
              // свежий in-flight 'sending' (захвачен прошлым опросом, ещё не подтверждён)
              and(eq(whatsappQueue.status, 'sending'), gte(whatsappQueue.sentAt, staleBefore))
            )
          )
        );
      for (const r of occupiedRows) occupiedKeys.add(dedupKey(r));
    }

    // Решаем, что выдать (по одному на ключ), а что пометить 'skipped'.
    const { toClaim, toSkip } = planDelivery(candidates, occupiedKeys);

    // Дубликаты/занятые ключи -> 'skipped' (финальный статус, больше не выдаются).
    if (toSkip.length > 0) {
      await db
        .update(whatsappQueue)
        .set({ status: 'skipped', sentAt: now, updatedAt: now })
        .where(and(inArray(whatsappQueue.id, toSkip), ne(whatsappQueue.status, 'sent')));
      console.info(
        '[whatsapp/pending] skipped duplicate/occupied messages',
        JSON.stringify({ count: toSkip.length, ids: toSkip })
      );
    }

    if (toClaim.length === 0) {
      return NextResponse.json({ success: true, items: [] });
    }

    // Атомарная заявка: переводим в 'sending' только строки, всё ещё eligible —
    // защита от гонки параллельных опросов (второй не получит уже захваченные).
    const claimed = await db
      .update(whatsappQueue)
      .set({ status: 'sending', sentAt: now, updatedAt: now })
      .where(and(inArray(whatsappQueue.id, toClaim), eligible))
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
      items: claimed.map((it) => ({ id: it.id, phone: it.phone, text: it.text })),
    });
  } catch (error: any) {
    console.error('Error fetching WhatsApp pending:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
