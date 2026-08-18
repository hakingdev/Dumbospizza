import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../lib/models';
import { Order } from '../../../../../lib/models/order.model';
import { getSetting } from '../../../../../lib/settings';
import { authorizePos } from '../../../../../lib/pos/auth';
import {
  POS_ACTIVE_ORDER_STATUSES,
  POS_FINISHED_ORDER_STATUSES,
  countByStatus,
  posEuro,
  toBoardOrder,
  type PosBoardOrder,
} from '../../../../../lib/pos/board';
import { workingDayStart } from '../../../../../lib/orders/working-day';
import {
  activeWorkshopBlocks,
  isBlockActive,
  laterUntil,
  readWorkshopBlocks,
  type WorkshopId,
} from '../../../../../lib/kitchen/workshops';

export const dynamic = 'force-dynamic';

/**
 * GET /api/pos/v1/board — всё, что нужно ленте терминала, одним запросом.
 *
 * Одним, а не тремя, потому что прибор опрашивает его постоянно: заказы,
 * числа на вкладках и состояние стопа кухни меняются вместе, и три отдельных
 * запроса показали бы ленту одной секунды со счётчиками другой.
 *
 * Показывает РАБОЧИЙ ДЕНЬ, а не историю: всё, что принято после 01:00 по Берлину.
 * В час ночи доставки уже нет, и всё незакрытое перестало быть работой — экран
 * начинает следующую смену с чистого листа. Заказы никуда не деваются, они
 * остаются в админке; терминал просто перестаёт выдавать их за текущую работу.
 */
export async function GET(request: NextRequest) {
  const auth = await authorizePos(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const now = new Date();
    const nowMs = now.getTime();

    // Одна граница на всё: и незакрытые, и закрытые заказы живут ровно текущую
    // смену. Раньше окон было два (сутки и календарный день), и заказ мог
    // исчезнуть из «Geliefert» в полночь, оставшись в «Zubereitung» до утра.
    const since = workingDayStart(now);

    const [activeRows, finishedRows, settings] = await Promise.all([
      Order.find({
        status: { $in: [...POS_ACTIVE_ORDER_STATUSES] },
        createdAt: { $gte: since },
      })
        .sort({ createdAt: 1 })
        .lean(),
      Order.find({
        status: { $in: [...POS_FINISHED_ORDER_STATUSES] },
        createdAt: { $gte: since },
      })
        .sort({ createdAt: -1 })
        .lean(),
      getSetting<Record<string, any>>('storeSettings', {}),
    ]);

    const finishedToday = finishedRows as any[];

    const orders = [...(activeRows as any[]), ...finishedToday]
      .map(toBoardOrder)
      .filter((order): order is PosBoardOrder => order !== null);

    // Итог смены считаем по тем же строкам, что показываем: расхождение между
    // суммой внизу и карточками выше выглядит как потерянные деньги.
    const dayTotal = { delivered: 0, cancelled: 0 };
    for (const order of finishedToday) {
      const bucket = order.status === 'cancelled' ? 'cancelled' : 'delivered';
      dayTotal[bucket] += Number(order.total) || 0;
    }

    return NextResponse.json(
      {
        success: true,
        // Прибор считает обратный отсчёт по времени СЕРВЕРА: часы на приборе
        // уезжают, и тогда таймер врёт кухне, а не только экрану.
        serverTimeMs: nowMs,
        orders,
        counts: countByStatus(orders),
        dayTotal: {
          delivered: posEuro(dayTotal.delivered),
          cancelled: posEuro(dayTotal.cancelled),
        },
        pause: readPause(settings, now),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: any) {
    console.error('[pos] board error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * Активный стоп для баннера паузы.
 *
 * Область «all» ставится и при глобальном стопе, и когда стоят ОБА цеха: для
 * кухни это одно и то же положение дел — готовить нечего. Один стоящий цех
 * называется своим именем, иначе баннер обещал бы больше, чем случилось.
 */
function readPause(
  settings: Record<string, any> | null | undefined,
  now: Date
): { scope: 'all' | WorkshopId; untilIso: string } | null {
  const blocks = readWorkshopBlocks(settings);
  const globalUntil = isBlockActive(settings?.ordersBlockedUntil, now)
    ? String(settings?.ordersBlockedUntil)
    : '';
  const stopped = activeWorkshopBlocks(blocks, now);

  if (!globalUntil && stopped.length === 0) return null;

  if (globalUntil || stopped.length > 1) {
    const untilIso = stopped.reduce<string>(
      (latest, id) => laterUntil(latest, blocks[id]),
      globalUntil
    );
    return { scope: 'all', untilIso };
  }

  return { scope: stopped[0], untilIso: blocks[stopped[0]] };
}
