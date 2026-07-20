import { NextRequest, NextResponse } from 'next/server';
import { completeRegistration } from '../../../../../../lib/auth/oauth/account';
import { clearTicketCookie, readTicket } from '../../../../../../lib/auth/oauth/ticket';
import { setCustomerCookie } from '../../../../../../lib/customer-auth';
import { getClientIp, logSecurityEvent, rateLimit } from '../../../../../../lib/security/rate-limit';

export const runtime = 'nodejs';

const EXPIRED = 'Die Anmeldung ist abgelaufen. Bitte erneut mit Google oder Apple anmelden.';

/**
 * GET /api/customer/auth/oauth/complete — что известно из талона.
 * Нужен странице /account/complete-profile, чтобы подставить имя от провайдера
 * и показать, какой аккаунт привязывается.
 */
export async function GET(request: NextRequest) {
  const ticket = readTicket(request);
  if (!ticket) {
    return NextResponse.json({ success: false, error: EXPIRED }, { status: 401 });
  }
  return NextResponse.json({
    success: true,
    pending: { provider: ticket.provider, name: ticket.name, email: ticket.email },
  });
}

/**
 * POST /api/customer/auth/oauth/complete — телефон + имя → аккаунт и сессия.
 * Личность берём ТОЛЬКО из подписанного талона: provider/subject из тела
 * запроса означали бы вход под любым аккаунтом по одному лишь знанию `sub`.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const limit = rateLimit(`oauth-complete:ip:${ip}`, 10, 15 * 60 * 1000);
  if (!limit.allowed) {
    logSecurityEvent('oauth_complete_rate_limited', { ip });
    return NextResponse.json(
      { success: false, error: 'Zu viele Versuche. Bitte später erneut versuchen.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  const ticket = readTicket(request);
  if (!ticket) {
    return NextResponse.json({ success: false, error: EXPIRED }, { status: 401 });
  }

  try {
    const data = await request.json().catch(() => ({}));
    const result = await completeRegistration(ticket, {
      name: data.name,
      phoneNumber: String(data.phoneNumber || ''),
    });

    if (result.kind === 'error') {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

    logSecurityEvent('oauth_registration_completed', {
      ip,
      provider: ticket.provider,
      userId: result.userId,
    });

    const response = NextResponse.json({ success: true });
    clearTicketCookie(response);
    return setCustomerCookie(response, result.userId);
  } catch (error: any) {
    console.error('oauth complete error:', error);
    return NextResponse.json({ success: false, error: 'Serverfehler' }, { status: 500 });
  }
}
