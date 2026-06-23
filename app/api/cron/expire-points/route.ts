import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { expirePoints } from '../../../../lib/loyalty/service';

/**
 * Cron: сгорание баллов лояльности (earn-батчи старше expiryMonths).
 * Авторизация (как у других cron-роутов):
 *   Header: Authorization: Bearer CRON_SECRET  ИЛИ  ?secret=CRON_SECRET
 */
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
    const expired = await expirePoints();
    return NextResponse.json({ success: true, expiredPoints: expired });
  } catch (error: any) {
    console.error('GET /api/cron/expire-points', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
