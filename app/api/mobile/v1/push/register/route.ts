import { NextRequest, NextResponse } from 'next/server';
import { getClientIp, logSecurityEvent, rateLimit } from '../../../../../../lib/security/rate-limit';
import { parseRegisterBody } from '../../../../../../lib/push/validate';
import { registerDevice } from '../../../../../../lib/push/service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/v1/push/register — публичный, вызывает приложение
 * «Dumbo Slice» при старте/смене согласия. Идемпотентный upsert по token.
 * Контракт: docs/push-notifications.md.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimit(`push-register:${ip}`, 30, 10 * 60_000);
  if (!rl.allowed) {
    logSecurityEvent('push_register_rate_limited', { ip });
    return NextResponse.json(
      { success: false, error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = parseRegisterBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  }

  try {
    await registerDevice(parsed.value);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('POST /api/mobile/v1/push/register', error?.message);
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}
