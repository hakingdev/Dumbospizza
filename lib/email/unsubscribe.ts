import crypto from 'crypto';

/**
 * Подписанные ссылки отписки. Email кодируется в токен и подписывается HMAC,
 * чтобы:
 *  - не хранить токены в БД,
 *  - нельзя было отписать чужой адрес, подставив его в URL.
 *
 * Токен = base64url(email) + '.' + base64url(hmac).
 */

function secret(): string {
  return (
    process.env.UNSUBSCRIBE_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    'dumbos-unsubscribe-fallback-secret'
  );
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(email: string): string {
  return crypto.createHmac('sha256', secret()).update(email).digest('base64url');
}

export function makeUnsubscribeToken(email: string): string {
  const normalized = email.trim().toLowerCase();
  return `${b64url(normalized)}.${sign(normalized)}`;
}

/** Проверяет токен и возвращает email (lowercase) либо null, если подпись неверна. */
export function verifyUnsubscribeToken(token: string): string | null {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [emailPart, sig] = token.split('.', 2);
  let email: string;
  try {
    email = Buffer.from(emailPart, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!email) return null;

  const expected = sign(email);
  // Сравнение постоянного времени — без утечки по таймингу.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  return email;
}

/** Полный URL отписки для письма. */
export function buildUnsubscribeUrl(siteUrl: string, email: string): string {
  return `${siteUrl}/api/email/unsubscribe?token=${encodeURIComponent(makeUnsubscribeToken(email))}`;
}
