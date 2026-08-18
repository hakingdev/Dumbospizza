import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../lib/models';
import { Order } from '../../../../../lib/models/order.model';
import { visibleOrderStatusFilter } from '../../../../../lib/orders/payment-draft';
import { authorizePosDevice } from '../../../../../lib/pos/auth';
import { getPosPrintSettings } from '../../../../../lib/pos/settings';
import { buildPrintJob } from '../../../../../lib/pos/print-job';

export const dynamic = 'force-dynamic';

/** Не отдаём больше, чем кухня успеет разобрать за один тик. */
const MAX_BATCH = 5;

/**
 * Окно выборки. Если прибор был выключен полдня, он НЕ должен выплюнуть все
 * заказы разом — напечатает только последние два часа, остальное осознанно
 * теряется. Пропущенный чек лучше метровой ленты, которую никто не читает.
 */
const MAX_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * GET /api/pos/v1/orders?sinceMs=<epoch>&limit=<n>
 *
 * Заказы для печати на POS-приборе. Эндпойнт СТРОГО ЧИТАЮЩИЙ.
 *
 * Прибор — наблюдатель, как и Telegram: он показывает и печатает заказ, но не
 * владеет им. Состояние заказа (`kitchenPrintStatus`) остаётся за LAN-агентом,
 * который печатает на Epson. Если бы прибор забирал заказы из общей очереди,
 * они распределялись бы между ним и агентом случайно — кто первым опросил, тот
 * и забрал, — и половина чеков перестала бы выходить на кухне.
 *
 * Учёт напечатанного ведёт сам прибор (PosPrefs): у него persistent-хранилище
 * ключей `orderId:printSeq`, переживающее перезапуск. Поэтому серверу не нужны
 * ни новое поле, ни таблица, ни миграция.
 *
 * Окно считается по `updatedAt`, а НЕ по `createdAt`. Сначала было по createdAt —
 * и повтор печати не работал вовсе: «Erneut drucken» поднимает `kitchenPrintSeq`,
 * но время создания не трогает, поэтому заказ уже никогда не попадал в выборку и
 * прибор о повторе не узнавал. Обратной связи при этом нет никакой: сервер
 * отвечает «поставлено в очередь», а чек не выходит.
 *
 * Лишних чеков это не даёт: заказ вернётся в выборку и после смены статуса, но
 * ключ `orderId:printSeq` у него прежний, и прибор такой заказ пропустит. Печатает
 * он только то, чего не видел, — а повтор это и есть новый printSeq.
 */
export async function GET(request: NextRequest) {
  const auth = authorizePosDevice(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const settings = await getPosPrintSettings();
    const nowMs = Date.now();

    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      MAX_BATCH,
      Math.max(1, parseInt(searchParams.get('limit') || '3', 10) || 3)
    );

    const requestedSince = parseInt(searchParams.get('sinceMs') || '', 10);
    const floor = nowMs - MAX_WINDOW_MS;
    const since = Number.isFinite(requestedSince)
      ? new Date(Math.max(requestedSince, floor))
      : new Date(floor);

    // Гейт по оплате тот же, что у агента: неоплаченный онлайн-заказ на кухню не
    // уезжает, оплата при получении проходит всегда. Драфты pending_payment
    // отсекает visibleOrderStatusFilter.
    const base = {
      status: visibleOrderStatusFilter(null),
      updatedAt: { $gt: since },
      $or: [{ paymentMethod: { $ne: 'online' } }, { paymentStatus: 'completed' }],
    };

    /**
     * Выключатель называется «АВТОМАТИЧЕСКИ печатать» — и гасить он должен
     * только автоматику.
     *
     * Раньше он закрывал эндпойнт целиком: при выключенной автопечати прибор не
     * получал НИЧЕГО, и кнопка «Erneut drucken» переставала работать вместе с
     * ней. Со стороны кухни это выглядело как сломанная кнопка: сервер отвечает
     * «поставлено в очередь», бумага не выходит, и никто не может объяснить почему.
     *
     * Явная просьба человека сильнее настройки: заказ с `kitchenPrintSeq > 0`
     * (кто-то нажал «печатать ещё раз») уезжает на прибор всегда. Идемпотентность
     * держит сам прибор по ключу `orderId:printSeq` — второго чека не будет.
     */
    const filter = settings.enabled ? base : { ...base, kitchenPrintSeq: { $gt: 0 } };

    const orders = await Order.find(filter).sort({ updatedAt: 1 }).limit(limit).lean();

    const jobs = orders
      .map((order: any) => buildPrintJob(order, { ...settings, workshops: null }))
      .filter((job): job is NonNullable<typeof job> => job !== null);

    return NextResponse.json({
      success: true,
      jobs,
      /** Автопечать выключена: сюда попадают только заказы, напечатать которые попросили руками. */
      paused: !settings.enabled,
      // Прибор двигает курсор по времени СЕРВЕРА, а не своим: часы на приборе
      // могут уехать, и тогда он либо пропустит заказы, либо начнёт их повторять.
      serverTimeMs: nowMs,
    });
  } catch (error: any) {
    console.error('[pos] orders error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
