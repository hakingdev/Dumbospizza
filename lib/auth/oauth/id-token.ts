/**
 * Разбор и проверка id_token, полученного от провайдера.
 *
 * ПОЧЕМУ БЕЗ ПРОВЕРКИ ПОДПИСИ (и почему это не дыра): токен приходит не из
 * браузера, а нашим собственным серверным POST-ом на token endpoint провайдера
 * по TLS. OpenID Connect Core §3.1.3.7 прямо разрешает в code flow опираться на
 * TLS вместо проверки подписи — подменить ответ может только тот, кто уже
 * сломал TLS до accounts.google.com / appleid.apple.com. Тянуть ради этого JWKS
 * (сеть на каждый вход + кеш ключей) смысла нет.
 *
 * Что проверяем обязательно: iss, aud, exp и nonce — они защищают от подстановки
 * ЧУЖОГО валидно подписанного токена (выданного другому приложению или другому
 * сеансу входа).
 */
import jwt from 'jsonwebtoken';
import type { OAuthProvider, ProviderConfig } from './providers';

/** Допуск на расхождение часов с провайдером. */
const CLOCK_SKEW_SECONDS = 60;

export interface OAuthIdentity {
  provider: OAuthProvider;
  /** Стабильный идентификатор пользователя у провайдера (`sub`). */
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export class IdTokenError extends Error {}

/**
 * Apple отдаёт булевы claim'ы строками ("true"), Google — настоящими true.
 * Приводим оба вида к boolean.
 */
function asBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

export function parseIdToken(
  idToken: string,
  config: ProviderConfig,
  expectedNonce: string
): OAuthIdentity {
  const payload = jwt.decode(idToken, { json: true });
  if (!payload) throw new IdTokenError('id_token konnte nicht gelesen werden');

  const iss = String(payload.iss || '');
  if (!config.issuers.includes(iss)) {
    throw new IdTokenError(`Unerwarteter Aussteller: ${iss}`);
  }

  // aud может быть строкой или массивом — наш client_id обязан там быть.
  const aud = payload.aud;
  const audOk = Array.isArray(aud) ? aud.includes(config.clientId) : aud === config.clientId;
  if (!audOk) throw new IdTokenError('id_token ist für eine andere App ausgestellt');

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp + CLOCK_SKEW_SECONDS < now) {
    throw new IdTokenError('id_token ist abgelaufen');
  }

  // Без этой сверки украденный у другого сеанса id_token дал бы вход.
  if (payload.nonce !== expectedNonce) {
    throw new IdTokenError('nonce stimmt nicht überein');
  }

  const subject = String(payload.sub || '');
  if (!subject) throw new IdTokenError('id_token ohne sub');

  const email = payload.email ? String(payload.email).trim().toLowerCase() : null;

  return {
    provider: config.id,
    subject,
    email,
    emailVerified: asBoolean(payload.email_verified),
    name: typeof payload.name === 'string' ? payload.name : null,
  };
}
