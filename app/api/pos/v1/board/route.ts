import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../lib/models';
import { Order } from '../../../../../lib/models/order.model';
import { getSetting } from '../../../../../lib/settings';
import { authorizePos } from '../../../../../lib/pos/auth';
import {
  POS_ACTIVE_ORDER_STATUSES,
  POS_FINISHED_ORDER_STATUSES,
  berlinDayKey,
  countByStatus,
  posEuro,
  toBoardOrder,
  type PosBoardOrder,
} from '../../../../../lib/pos/board';
import {
  activeWorkshopBlocks,
  isBlockActive,
  laterUntil,
  readWorkshopBlocks,
  type WorkshopId,
} from '../../../../../lib/kitchen/workshops';

export const dynamic = 'force-dynamic';

/** Окно выборки закрытых заказов. Дальше отсеиваем по календарному дню Берлина. */
const FINISHED_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Насколько старым может быть НЕЗАКРЫТЫЙ заказ, чтобы попасть на прибор.
 *
 * Сначала окна не было вовсе: раз заказ не закрыт — значит работа. На проде это
 * оказалось неверно. Заказы месячной давности, которые просто забыли перевести
 * в «завершён», числятся активными до сих пор, и кухня получила ленту из мусора,
 * где настоящий заказ не отличить от прошлогоднего.
 *
 * Сутки, а не «сегодня»: смена заканчивается в 22:00, и заказ, принятый в 21:50,
 * обязан дожить на экране до конца приготовления, даже если наступила полночь.
 *
 * База при этом НЕ трогается: старые заказы остаются в админке как были. Терминал
 * лишь перестаёт выдавать их за текущую работу.
 */
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/pos/v1/board — всё, что нужно ленте терминала, одним запросом.
 *
 * Одним, а не тремя, потому что прибор опрашивает его постоянно: заказы,
 * числа на вкладках и состояние стопа кухни меняются вместе, и три отдельных
 * запроса показали бы ленту одной секунды со счётчиками другой.
 *
 * Показывает работу текущей смены, а не историю: незакрытые заказы за последние
 * сутки, закрытые — за сегодняшний день Берлина. Всё, что старше, остаётся в
 * админке, но на кухню не попадает: заказ, забытый в статусе «готовится» месяц
 * назад, — это не работа на столе.
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

    const [activeRows, finishedRows, settings] = await Promise.all([
      Order.find({
        status: { $in: [...POS_ACTIVE_ORDER_STATUSES] },
        createdAt: { $gte: new Date(nowMs - ACTIVE_WINDOW_MS) },
      })
        .sort({ createdAt: 1 })
        .lean(),
      Order.find({
        status: { $in: [...POS_FINISHED_ORDER_STATUSES] },
        createdAt: { $gte: new Date(nowMs - FINISHED_WINDOW_MS) },
      })
        .sort({ createdAt: -1 })
        .lean(),
      getSetting<Record<string, any>>('storeSettings', {}),
    ]);

    const today = berlinDayKey(now);
    const finishedToday = (finishedRows as any[]).filter(
      (order) => berlinDayKey(order.createdAt) === today
    );

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
