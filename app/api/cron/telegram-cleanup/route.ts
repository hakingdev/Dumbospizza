import { NextRequest, NextResponse } from 'next/server';
import { cleanupStaleOrderCards } from '../../../../lib/telegram/card-cleanup';

/**
 * Cron: уборка карточек прошедших смен из группы заказов.
 *
 * Расписание в vercel.json — 01:00 UTC, то есть 02:00 (зима) / 03:00 (лето) по
 * Берлину. Vercel Cron знает только UTC, а граница смены — 01:00 по Берлину и
 * ездит с переводом часов. Один запуск ЗАВЕДОМО ПОСЛЕ границы надёжнее двух
 * записей в расписании, которые надо помнить и чинить дважды в год: к этому
 * часу доставки давно нет, и всё вчерашнее уже точно перестало быть работой.
 *
 * Авторизация (как у других cron-роутов):
 *   Header: Authorization: Bearer CRON_SECRET  ИЛИ  ?secret=CRON_SECRET
 *
 * Запустить руками (например, чтобы разобрать накопившееся):
 *   curl "https://www.dumbospizza.de/api/cron/telegram-cleanup?secret=…&limit=50"
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret) {
      return NextResponse.json({ success: false, error: 'CRON_SECRET not set' }, { status: 503 });
    }

    const auth = request.headers.get('authorization') || '';
    const querySecret = request.nextUrl.searchParams.get('secret');
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (bearer !== secret && querySecret !== secret) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const limitRaw = parseInt(request.nextUrl.searchParams.get('limit') || '', 10);
    const result = await cleanupStaleOrderCards(
      Number.isFinite(limitRaw) && limitRaw > 0 ? { limit: limitRaw } : {}
    );

    console.log('[telegram-cleanup]', result);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error('GET /api/cron/telegram-cleanup', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
