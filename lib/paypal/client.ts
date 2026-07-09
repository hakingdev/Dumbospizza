import { randomUUID } from 'crypto';
import { getPayPalConfig } from './config';

/**
 * HTTP-клиент PayPal (REST, нативный fetch — как lib/sumup.ts).
 *
 * Инварианты:
 *  - КАЖДЫЙ исходящий запрос несёт заголовок `PayPal-Request-Id` (идемпотентность
 *    на стороне PayPal): для мутирующих вызовов id передаёт вызывающий код
 *    (детерминированный uuid v5 / сохранённый в БД), для остальных генерируется.
 *  - Access token (OAuth2 client_credentials) кэшируется в памяти с
 *    TTL = expires_in − 60s; параллельные запросы не плодят токены (single-flight).
 *  - Секреты и access token НИКОГДА не попадают в логи и в тексты ошибок.
 */

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;
let tokenInflight: Promise<string> | null = null;

/** Ошибка PayPal API: статус + разобранное тело (тело PayPal секретов не содержит). */
export class PayPalApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'PayPalApiError';
    this.status = status;
    this.body = body;
  }

  /** Код проблемы из details[0].issue (INSTRUMENT_DECLINED, ORDER_ALREADY_CAPTURED, …). */
  get issue(): string | undefined {
    const body = this.body as { details?: Array<{ issue?: string }> } | null;
    return body?.details?.[0]?.issue;
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function requestAccessToken(): Promise<TokenCache> {
  const cfg = getPayPalConfig();
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');

  const res = await fetch(`${cfg.baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'PayPal-Request-Id': randomUUID(),
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    // Тело ошибки OAuth ({error, error_description}) секретов не содержит.
    throw new PayPalApiError('PayPal OAuth fehlgeschlagen', res.status, await parseBody(res));
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  return {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(0, (Number(data.expires_in) || 0) - 60) * 1000,
  };
}

/** Access token с кэшем и single-flight-обновлением. */
export async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  if (!tokenInflight) {
    tokenInflight = requestAccessToken()
      .then((t) => {
        tokenCache = t;
        return t.token;
      })
      .finally(() => {
        tokenInflight = null;
      });
  }
  return tokenInflight;
}

/** Сброс кэша токена (только для тестов). */
export function resetPayPalTokenCacheForTests(): void {
  tokenCache = null;
  tokenInflight = null;
}

export interface PayPalResponse<T> {
  status: number;
  data: T;
}

/**
 * POST к PayPal. `requestId` обязателен — это наш идемпотентный `PayPal-Request-Id`.
 * `body`-строка уходит как есть (нужно вебхук-верификации: сырое тело события
 * должно попасть в запрос байт-в-байт); объект сериализуется JSON'ом.
 * Ответ ≥ 400 → PayPalApiError.
 */
export async function paypalPost<T = unknown>(
  path: string,
  body: unknown,
  requestId: string
): Promise<PayPalResponse<T>> {
  if (!requestId) {
    throw new Error(`PayPal-Request-Id ist Pflicht für POST ${path}`);
  }
  const cfg = getPayPalConfig();
  const token = await getAccessToken();

  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': requestId,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body ?? {}),
  });

  const data = await parseBody(res);
  if (!res.ok) {
    throw new PayPalApiError(`PayPal POST ${path} → ${res.status}`, res.status, data);
  }
  return { status: res.status, data: data as T };
}

/** GET к PayPal (тоже с PayPal-Request-Id — единообразие для аудита). */
export async function paypalGet<T = unknown>(path: string): Promise<PayPalResponse<T>> {
  const cfg = getPayPalConfig();
  const token = await getAccessToken();

  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'PayPal-Request-Id': randomUUID(),
    },
  });

  const data = await parseBody(res);
  if (!res.ok) {
    throw new PayPalApiError(`PayPal GET ${path} → ${res.status}`, res.status, data);
  }
  return { status: res.status, data: data as T };
}
