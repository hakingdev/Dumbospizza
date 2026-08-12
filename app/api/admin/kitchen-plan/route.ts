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
import {
  normalizeStaffing,
  KITCHEN_STAFFING_KEY,
  DEFAULT_STAFFING,
} from '../../../../lib/eta/order-eta';
import { setSetting } from '../../../../lib/settings';
import type { KitchenPlan, KitchenStaffing } from '../../../../lib/eta/types';

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

    // Отпечаток очереди: тот же состав, статусы, число курьеров и персонал → тот же план.
    const fingerprint = [
      ...context.orders.map((o) => `${o.orderNumber}:${o.status}`),
      `road:${context.onTheRoad.join(',')}`,
      `couriers:${context.courierCount}`,
      `staff:${context.staffing.pizzaCooks}/${context.staffing.fryerHelpers}/${context.staffing.sushiChefs}`,
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
        staffing: context.staffing,
        cached: true,
      });
    }

    const plan = await planFromContext(context);
    cache = { fingerprint, at: Date.now(), plan };

    return NextResponse.json({
      success: true,
      plan,
      courierCount: context.courierCount,
      staffing: context.staffing,
      cached: false,
    });
  } catch (error: any) {
    console.error('[kitchen-plan] route failed:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/admin/kitchen-plan — настройки смены: число курьеров и/или персонал
 * кухни. Тело: { courierCount?: number, staffing?: { pizzaCooks, fryerHelpers,
 * sushiChefs } }. Сбрасывает кэш плана — следующий GET пересчитает.
 * Персонал влияет и на AI-оценку времени новых заказов (lib/eta/order-eta.ts).
 */
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();

    const session = await getServerSession(authOptions);
    if (!session || !isStaff(session)) {
      return NextResponse.json({ success: false, error: 'Unauthorized access' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const hasCouriers = body?.courierCount !== undefined;
    const hasStaffing = body?.staffing !== undefined;
    if (!hasCouriers && !hasStaffing) {
      return NextResponse.json(
        { success: false, error: 'Provide courierCount and/or staffing' },
        { status: 400 }
      );
    }

    let courierCount: number | undefined;
    if (hasCouriers) {
      const raw = Number(body.courierCount);
      // normalize* мусор превращает в дефолт — здесь явный отказ честнее.
      if (!Number.isFinite(raw) || Math.round(raw) < 1 || Math.round(raw) > 6) {
        return NextResponse.json(
          { success: false, error: 'courierCount must be between 1 and 6' },
          { status: 400 }
        );
      }
      courierCount = normalizeCourierCount(raw);
      await setSetting(COURIER_COUNT_KEY, courierCount);
    }

    let staffing: KitchenStaffing | undefined;
    if (hasStaffing) {
      const s = body.staffing ?? {};
      const inRange = (v: unknown, min: number, max: number) => {
        const n = Number(v);
        return Number.isFinite(n) && Math.round(n) >= min && Math.round(n) <= max;
      };
      if (
        !inRange(s.pizzaCooks, 1, 4) ||
        !inRange(s.fryerHelpers, 0, 3) ||
        !inRange(s.sushiChefs, 1, 4)
      ) {
        return NextResponse.json(
          {
            success: false,
            error: 'staffing: pizzaCooks 1…4, fryerHelpers 0…3, sushiChefs 1…4',
          },
          { status: 400 }
        );
      }
      staffing = normalizeStaffing(s);
      await setSetting(KITCHEN_STAFFING_KEY, staffing);
    }

    cache = null;

    return NextResponse.json({
      success: true,
      ...(courierCount !== undefined ? { courierCount } : {}),
      ...(staffing ? { staffing } : {}),
      defaults: { courierCount: PLAN_TUNING.courierCount, staffing: DEFAULT_STAFFING },
    });
  } catch (error: any) {
    console.error('[kitchen-plan] shift settings update failed:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
