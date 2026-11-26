import { NextRequest, NextResponse } from 'next/server';
import { checkReceipts, runDueCampaigns } from '../../../../lib/push/service';

/**
 * Cron: отправка запланированных push-кампаний + сбор receipts Expo
 * (доставлено / ошибка, деактивация DeviceNotRegistered).
 * Расписание — vercel.json, каждые 5 минут.
 *
 * Авторизация (как у других cron-роутов):
 *   Header: Authorization: Bearer CRON_SECRET  ИЛИ  ?secret=CRON_SECRET
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

    const now = new Date();
    const campaigns = await runDueCampaigns(now);
    let receipts: Awaited<ReturnType<typeof checkReceipts>> | { error: string };
    try {
      receipts = await checkReceipts(now);
    } catch (e) {
      // Receipts — best-effort, следующий запуск доберёт.
      receipts = { error: (e as Error)?.message || 'receipts failed' };
    }
    const result = { ...campaigns, receipts };
    if (campaigns.sent.length || campaigns.stuck) console.log('[push-campaigns]', result);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error('GET /api/cron/push-campaigns', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
