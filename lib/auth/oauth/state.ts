/**
 * Транзакция OAuth-входа: state (CSRF), nonce (привязка id_token к запросу) и
 * адрес возврата.
 *
 * Всё лежит в ОДНОЙ подписанной cookie, а не в трёх отдельных: state в URL
 * сверяется со state внутри cookie, поэтому подделать callback, не имея нашей
 * подписи, нельзя. Живёт 10 минут — столько занимает экран согласия.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { NextResponse, type NextRequest } from 'next/server';
import { getAuthSecret } from '../../customer-auth';
import type { OAuthProvider } from './providers';

export const OAUTH_TX_COOKIE = 'dp_oauth_tx';
const TX_TTL_SECONDS = 10 * 60;
const AUDIENCE = 'customer-oauth-tx';

/** Куда возвращаем после успешного входа, если ничего не передали. */
export const DEFAULT_RETURN_TO = '/account';

export interface OAuthTransaction {
  provider: OAuthProvider;
  state: string;
  nonce: string;
  returnTo: string;
}

/**
 * Открытый редирект — классическая дыра в OAuth-callback: `?returnTo=https://зло`
 * превращает наш домен в трамплин для фишинга. Пускаем только относительные
 * пути; `//host` и `/\host` браузер трактует как протокол-относительный URL,
 * поэтому их тоже режем.
 */
export function sanitizeReturnTo(raw?: string | null): string {
  const value = String(raw || '');
  if (!value.startsWith('/')) return DEFAULT_RETURN_TO;
  if (value.startsWith('//') || value.startsWith('/\\')) return DEFAULT_RETURN_TO;
  return value;
}

export function createTransaction(
  provider: OAuthProvider,
  returnTo?: string | null
): OAuthTransaction {
  return {
    provider,
    state: crypto.randomBytes(24).toString('base64url'),
    nonce: crypto.randomBytes(24).toString('base64url'),
    returnTo: sanitizeReturnTo(returnTo),
  };
}

export function setTransactionCookie(
  response: NextResponse,
  tx: OAuthTransaction,
  options: { crossSitePost: boolean }
): NextResponse {
  const token = jwt.sign({ ...tx, aud: AUDIENCE }, getAuthSecret(), {
    expiresIn: TX_TTL_SECONDS,
  });

  response.cookies.set(OAUTH_TX_COOKIE, token, {
    httpOnly: true,
    // Apple возвращает пользователя POST-ом со своего домена (form_post): при
    // SameSite=Lax браузер cookie не пришлёт и вход сорвётся на «нет state».
    // None обязателен вместе с Secure, поэтому Apple-вход работает только по HTTPS.
    sameSite: options.crossSitePost ? 'none' : 'lax',
    secure: options.crossSitePost || process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TX_TTL_SECONDS,
  });
  return response;
}

export function readTransaction(request: NextRequest): OAuthTransaction | null {
  const token = request.cookies.get(OAUTH_TX_COOKIE)?.value;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, getAuthSecret(), {
      audience: AUDIENCE,
    }) as jwt.JwtPayload & Partial<OAuthTransaction>;
    if (!payload.provider || !payload.state || !payload.nonce) return null;
    return {
      provider: payload.provider,
      state: payload.state,
      nonce: payload.nonce,
      returnTo: sanitizeReturnTo(payload.returnTo),
    };
  } catch {
    return null;
  }
}

export function clearTransactionCookie(response: NextResponse): NextResponse {
  response.cookies.set(OAUTH_TX_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}

/**
 * Сравнение state в постоянном времени. Разница длин здесь не секрет
 * (оба — base64url от 24 байт), но timingSafeEqual на разных длинах бросает.
 */
export function statesMatch(fromUrl: string | null, fromCookie: string): boolean {
  if (!fromUrl) return false;
  const a = Buffer.from(fromUrl);
  const b = Buffer.from(fromCookie);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
