import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { runHappyHourAutoNotifications } from '../../../../lib/promotions/campaign';

/**
 * Cron: auto email/push when Happy Hour starts.
 * Header: Authorization: Bearer CRON_SECRET
 * or ?secret=CRON_SECRET
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
    const result = await runHappyHourAutoNotifications();
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error('GET /api/cron/promotion-notifications', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
