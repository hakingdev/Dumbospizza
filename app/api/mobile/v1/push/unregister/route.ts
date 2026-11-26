import { NextRequest, NextResponse } from 'next/server';
import { getClientIp, logSecurityEvent, rateLimit } from '../../../../../../lib/security/rate-limit';
import { parseUnregisterBody } from '../../../../../../lib/push/validate';
import { unregisterDevice } from '../../../../../../lib/push/service';

export const dynamic = 'force-dynamic';

/** POST /api/mobile/v1/push/unregister { token } — выключает устройство (active=false). */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimit(`push-unregister:${ip}`, 30, 10 * 60_000);
  if (!rl.allowed) {
    logSecurityEvent('push_unregister_rate_limited', { ip });
    return NextResponse.json(
      { success: false, error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = parseUnregisterBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  }

  try {
    await unregisterDevice(parsed.value.token);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('POST /api/mobile/v1/push/unregister', error?.message);
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}
