import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { connectToDatabase } from '../../../../lib/models';
import { authOptions, isStaff } from '../../../../lib/auth';
import {
  cleanupStalePaymentDrafts,
  DRAFT_TTL_MINUTES,
} from '../../../../lib/orders/payment-draft';

/**
 * GET/POST /api/payments/cleanup-drafts — TTL-очистка брошенных онлайн-драфтов
 * (pending_payment + неоплачен дольше 45 минут → payment_status='failed').
 *
 * Вызывается кроном (Vercel Cron шлёт GET с Authorization: Bearer CRON_SECRET)
 * или админом вручную. Дополнительная страховка — ленивый свип из
 * GET /api/orders (принт-агент опрашивает очередь круглосуточно), так что
 * очистка работает и без настроенного крона.
 */
async function handle(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  const viaCron = Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;

  if (!viaCron) {
    const session = await getServerSession(authOptions);
    if (!session || !isStaff(session)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  await connectToDatabase();
  const cleaned = await cleanupStalePaymentDrafts();
  return NextResponse.json({ success: true, cleaned, ttlMinutes: DRAFT_TTL_MINUTES });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
