import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { getServerSession } from 'next-auth';
import { authOptions, isStaff } from '../../../../lib/auth';
import {
  buildKitchenPlanContext,
  planFromContext,
  normalizeCourierCount,
  COURIER_COUNT_KEY,
  PLAN_TUNING,
} from '../../../../lib/eta/kitchen-plan';
import { setSetting } from '../../../../lib/settings';
import type { KitchenPlan } from '../../../../lib/eta/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET /api/admin/kitchen-plan — AI-план кухни: последовательность готовки и
 * рейсы курьера для активных заказов.
 *
 * Кэш на модуль: план пересчитывается (и тратит вызов Claude) только когда
 * изменился состав очереди/статусы или прошло TTL. ?refresh=1 — принудительно.
 */
const CACHE_TTL_MS = 2 * 60 * 1000;

let cache: { fingerprint: string; at: number; plan: KitchenPlan } | null = null;

export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();

    const session = await getServerSession(authOptions);
    if (!session || !isStaff(session)) {
      return NextResponse.json({ success: false, error: 'Unauthorized access' }, { status: 401 });
    }

    const refresh = request.nextUrl.searchParams.get('refresh') === '1';
    const context = await buildKitchenPlanContext();

    // Отпечаток очереди: тот же состав, статусы и число курьеров → тот же план.
    const fingerprint = [
      ...context.orders.map((o) => `${o.orderNumber}:${o.status}`),
      `road:${context.onTheRoad.join(',')}`,
      `couriers:${context.courierCount}`,
    ].join('|');

    if (
      !refresh &&
      cache &&
      cache.fingerprint === fingerprint &&
      Date.now() - cache.at < CACHE_TTL_MS
    ) {
      return NextResponse.json({
        success: true,
        plan: cache.plan,
        courierCount: context.courierCount,
        cached: true,
      });
    }

    const plan = await planFromContext(context);
    cache = { fingerprint, at: Date.now(), plan };

    return NextResponse.json({
      success: true,
      plan,
      courierCount: context.courierCount,
      cached: false,
    });
  } catch (error: any) {
    console.error('[kitchen-plan] route failed:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/admin/kitchen-plan — установить число курьеров на смене.
 * Тело: { courierCount: number } (1…6). Сбрасывает кэш плана — следующий GET
 * пересчитает с новым числом.
 */
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();

    const session = await getServerSession(authOptions);
    if (!session || !isStaff(session)) {
      return NextResponse.json({ success: false, error: 'Unauthorized access' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const raw = Number(body?.courierCount);
    if (!Number.isFinite(raw)) {
      return NextResponse.json(
        { success: false, error: 'courierCount must be a number (1…6)' },
        { status: 400 }
      );
    }
    // normalizeCourierCount мусор превращает в дефолт — здесь явный отказ честнее.
    if (Math.round(raw) < 1 || Math.round(raw) > 6) {
      return NextResponse.json(
        { success: false, error: 'courierCount must be between 1 and 6' },
        { status: 400 }
      );
    }
    const courierCount = normalizeCourierCount(raw);

    await setSetting(COURIER_COUNT_KEY, courierCount);
    cache = null;

    return NextResponse.json({
      success: true,
      courierCount,
      default: PLAN_TUNING.courierCount,
    });
  } catch (error: any) {
    console.error('[kitchen-plan] courier update failed:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
