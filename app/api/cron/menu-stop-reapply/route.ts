import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { runIndefiniteReapply } from '../../../../lib/menu-stop/reapply-live';

/**
 * Cron: перевыключить на Lieferando бессрочный стоп-лист Telegram-стоп-бота
 * (lib/menu-stop, записи с until=null). Partner Hub возвращает всё выключенное
 * в продажу «к концу дня» (так и написано на странице доступности), поэтому
 * утром агенту заново ставятся команды off, а в группу уходит одна сводка
 * (lib/menu-stop/reapply).
 *
 * Штатно это запускает САМ ПОЛЛИНГ АГЕНТА (lib/menu-stop/reapply-live
 * maybeReapplyIndefiniteStops: раз в день после 08:30 по Берлину, до открытия
 * в 11:00) — Vercel Cron на Hobby-плане ограничен двумя задачами, и обе уже
 * заняты. Этот роут — ручной запуск (например, после правки стоп-листа днём)
 * и готовый вход, если проект на Pro: добавить в vercel.json
 *   { "path": "/api/cron/menu-stop-reapply", "schedule": "30 7 * * *" }.
 * Записи, уже включённые руками в админке/POS, снимаются и не трогаются.
 *
 * Авторизация (как у других cron-роутов):
 *   Header: Authorization: Bearer CRON_SECRET  ИЛИ  ?secret=CRON_SECRET
 *
 * Руками: curl "https://www.dumbospizza.de/api/cron/menu-stop-reapply?secret=…"
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

    await connectToDatabase();
    const result = await runIndefiniteReapply(new Date());
    console.log('[menu-stop-reapply]', result);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error('GET /api/cron/menu-stop-reapply', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
