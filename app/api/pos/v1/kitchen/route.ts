import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../lib/models';
import { getSetting } from '../../../../../lib/settings';
import { authorizePos } from '../../../../../lib/pos/auth';
import {
  CONTROL_SCOPES,
  applyBlockAction,
  readBlockState,
  type BlockState,
  type ControlScope,
} from '../../../../../lib/telegram-control';
import { remainingBlockMinutes } from '../../../../../lib/kitchen/workshops';

export const dynamic = 'force-dynamic';

/**
 * Стоп кухни с терминала (экраны 12 · Küche stoppen и 13 · Küchen-Status).
 *
 * Своей записи о паузе НЕ заводит: пишет через `applyBlockAction` в те же
 * `ordersBlockedUntil` и `workshopsBlockedUntil`, которыми уже управляют
 * стоп-бот и админка и которые читают сайт, мобилка и приём заказов. Иначе на
 * кухне появился бы второй выключатель, не связанный с первым, — и однажды
 * заказы шли бы при «остановленной» кухне.
 *
 * Максимум стопа — сутки: минуты приходят с прибора, а незамеченная опечатка
 * в сотню часов закрыла бы приём до следующей недели.
 */
const MAX_STOP_MINUTES = 24 * 60;
const MIN_STOP_MINUTES = 5;

function isScope(value: unknown): value is ControlScope {
  return CONTROL_SCOPES.includes(value as ControlScope);
}

/** Состояние для экрана: сколько минут осталось у каждой области. */
function toView(state: BlockState, now: Date) {
  return {
    scopes: CONTROL_SCOPES.map((scope) => {
      const until = scope === 'all' ? state.orders : state.workshops[scope] || '';
      return { scope, until: until || null, minutesLeft: remainingBlockMinutes(until, now) };
    }),
  };
}

export async function GET(request: NextRequest) {
  const auth = await authorizePos(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const settings = await getSetting<Record<string, any>>('storeSettings', {});
    return NextResponse.json(
      { success: true, ...toView(readBlockState(settings), new Date()) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: any) {
    console.error('[pos] kitchen read error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/pos/v1/kitchen — { scope: 'all' | 'pizza' | 'sushi', minutes: number }
 *
 * `minutes: 0` снимает стоп. Отдельного маршрута для снятия нет намеренно:
 * кнопки «стоп» и «Freigeben» стоят на одной карточке и обязаны попадать в одну
 * и ту же запись, иначе одна из них однажды промахнётся мимо другой.
 */
export async function POST(request: NextRequest) {
  const auth = await authorizePos(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const scope = body?.scope;
    const minutes = Number(body?.minutes);

    if (!isScope(scope)) {
      return NextResponse.json(
        { success: false, error: 'scope: all | pizza | sushi' },
        { status: 400 }
      );
    }
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_STOP_MINUTES) {
      return NextResponse.json(
        { success: false, error: `minutes: 0 (снять) или ${MIN_STOP_MINUTES}…${MAX_STOP_MINUTES}` },
        { status: 400 }
      );
    }
    if (minutes > 0 && minutes < MIN_STOP_MINUTES) {
      return NextResponse.json(
        { success: false, error: `minutes: не меньше ${MIN_STOP_MINUTES}` },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const now = new Date();
    const state = await applyBlockAction(
      minutes > 0 ? { type: 'block', scope, minutes } : { type: 'unblock', scope },
      now
    );

    console.log(
      `[pos] kitchen ${minutes > 0 ? `stop ${minutes}min` : 'release'} scope=${scope} by=${
        auth.caller.kind
      }`
    );

    return NextResponse.json({ success: true, ...toView(state, now) });
  } catch (error: any) {
    console.error('[pos] kitchen write error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
