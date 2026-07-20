import { NextRequest, NextResponse } from 'next/server';
import {
  getProviderConfig,
  isOAuthProvider,
} from '../../../../../../../lib/auth/oauth/providers';
import { exchangeCodeForIdToken } from '../../../../../../../lib/auth/oauth/flow';
import { parseIdToken } from '../../../../../../../lib/auth/oauth/id-token';
import {
  clearTransactionCookie,
  readTransaction,
  statesMatch,
} from '../../../../../../../lib/auth/oauth/state';
import { clearTicketCookie, setTicketCookie } from '../../../../../../../lib/auth/oauth/ticket';
import { resolveAccount } from '../../../../../../../lib/auth/oauth/account';
import { setCustomerCookie } from '../../../../../../../lib/customer-auth';
import { getClientIp, logSecurityEvent } from '../../../../../../../lib/security/rate-limit';
import { SITE_URL } from '../../../../../../../lib/site-url';

// jsonwebtoken/crypto недоступны в Edge-рантайме.
export const runtime = 'nodejs';

interface CallbackInput {
  code: string | null;
  state: string | null;
  error: string | null;
  /** Apple: JSON с именем, приходит ТОЛЬКО при первой авторизации. */
  userJson: string | null;
}

/** 303 — чтобы после form_post от Apple браузер пошёл GET-ом, а не повторил POST. */
function redirectTo(path: string): NextResponse {
  return NextResponse.redirect(new URL(path, SITE_URL), 303);
}

function fail(reason: string): NextResponse {
  return clearTransactionCookie(redirectTo(`/account?error=${reason}`));
}

/** Имя из тела form_post у Apple: {"name":{"firstName":"…","lastName":"…"}} */
function appleDisplayName(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const full = `${parsed?.name?.firstName || ''} ${parsed?.name?.lastName || ''}`.trim();
    return full || null;
  } catch {
    return null;
  }
}

async function handleCallback(
  request: NextRequest,
  providerParam: string,
  input: CallbackInput
): Promise<NextResponse> {
  if (!isOAuthProvider(providerParam)) {
    return NextResponse.json({ success: false, error: 'Unbekannter Anbieter' }, { status: 404 });
  }

  const config = getProviderConfig(providerParam);
  if (!config) return fail('provider_unavailable');

  // Транзакция должна существовать, быть от ЭТОГО провайдера и совпасть по state.
  const tx = readTransaction(request);
  if (!tx || tx.provider !== providerParam || !statesMatch(input.state, tx.state)) {
    logSecurityEvent('oauth_state_mismatch', {
      ip: getClientIp(request),
      provider: providerParam,
      hadCookie: Boolean(tx),
    });
    return fail('oauth_state');
  }

  if (input.error) {
    // Отказ на экране согласия — не ошибка, просто возвращаем откуда пришли.
    const cancelled = input.error === 'access_denied' || input.error === 'user_cancelled_authorize';
    return clearTransactionCookie(redirectTo(cancelled ? tx.returnTo : '/account?error=oauth_denied'));
  }

  if (!input.code) return fail('oauth_code');

  let identity;
  try {
    const idToken = await exchangeCodeForIdToken(config, input.code);
    identity = parseIdToken(idToken, config, tx.nonce);
  } catch (err) {
    console.error(`oauth callback (${providerParam}):`, err);
    return fail('oauth_exchange');
  }

  const resolved = await resolveAccount(identity);

  if (resolved.kind === 'user') {
    const response = redirectTo(tx.returnTo);
    clearTransactionCookie(response);
    // Гасим талон недоделанной прошлой регистрации, чтобы он не всплыл позже.
    clearTicketCookie(response);
    return setCustomerCookie(response, resolved.userId);
  }

  // Аккаунта ещё нет: не хватает телефона (см. lib/auth/oauth/ticket.ts).
  const next = `/account/complete-profile?returnTo=${encodeURIComponent(tx.returnTo)}`;
  const response = redirectTo(next);
  clearTransactionCookie(response);
  return setTicketCookie(response, identity, appleDisplayName(input.userJson));
}

/** Google возвращает пользователя обычным редиректом (query-параметры). */
export async function GET(request: NextRequest, { params }: { params: { provider: string } }) {
  const sp = request.nextUrl.searchParams;
  return handleCallback(request, params.provider, {
    code: sp.get('code'),
    state: sp.get('state'),
    error: sp.get('error'),
    userJson: null,
  });
}

/** Apple возвращает пользователя кросс-сайт POST-ом (response_mode=form_post). */
export async function POST(request: NextRequest, { params }: { params: { provider: string } }) {
  const form = await request.formData().catch(() => null);
  const read = (key: string) => {
    const value = form?.get(key);
    return typeof value === 'string' ? value : null;
  };
  return handleCallback(request, params.provider, {
    code: read('code'),
    state: read('state'),
    error: read('error'),
    userJson: read('user'),
  });
}
