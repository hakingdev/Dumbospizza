/**
 * Разговор с провайдером: сборка ссылки авторизации и обмен `code` на id_token.
 */
import jwt from 'jsonwebtoken';
import { getRedirectUri, type OAuthProvider, type ProviderConfig } from './providers';
import type { OAuthTransaction } from './state';

/** Ссылка, на которую уводим пользователя (экран согласия провайдера). */
export function buildAuthorizeUrl(config: ProviderConfig, tx: OAuthTransaction): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: getRedirectUri(config.id),
    response_type: 'code',
    scope: config.scope,
    state: tx.state,
    nonce: tx.nonce,
  });

  if (config.usesFormPost) {
    // Apple: при непустом scope ответ обязан идти form_post, иначе Apple
    // вернёт invalid_request.
    params.set('response_mode', 'form_post');
  } else {
    // Google: даём выбрать аккаунт, иначе молча войдёт последним использованным
    // — на общем компьютере это чужой заказ в истории.
    params.set('prompt', 'select_account');
  }

  return `${config.authorizeUrl}?${params.toString()}`;
}

/**
 * Приватный ключ Apple (.p8) в env хранится одной строкой с литеральными "\n" —
 * возвращаем настоящие переводы строк, иначе PEM не распарсится.
 */
function applePrivateKey(): string {
  return String(process.env.APPLE_PRIVATE_KEY || '')
    .replace(/\\n/g, '\n')
    .trim();
}

/**
 * У Apple нет статического client_secret: это JWT, подписанный ES256 ключом из
 * .p8, живущий не дольше 6 месяцев. Генерируем на каждый обмен — так не нужно
 * следить за протуханием.
 */
function appleClientSecret(config: ProviderConfig): string {
  return jwt.sign({}, applePrivateKey(), {
    algorithm: 'ES256',
    keyid: process.env.APPLE_KEY_ID,
    issuer: process.env.APPLE_TEAM_ID,
    audience: 'https://appleid.apple.com',
    subject: config.clientId,
    expiresIn: 60 * 60,
  });
}

function clientSecret(config: ProviderConfig): string {
  if (config.id === 'apple') return appleClientSecret(config);
  return String(process.env.GOOGLE_CLIENT_SECRET || '');
}

export class TokenExchangeError extends Error {}

/**
 * Обмен authorization code на id_token. Возвращаем только id_token: access_token
 * нам не нужен — к API провайдера мы не ходим, все нужные данные (sub, email)
 * лежат в самом id_token.
 */
export async function exchangeCodeForIdToken(
  config: ProviderConfig,
  code: string
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getRedirectUri(config.id),
    client_id: config.clientId,
    client_secret: clientSecret(config),
  });

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Apple отвечает 400 на запросы без User-Agent.
      'User-Agent': 'dumbospizza-auth',
    },
    body,
  });

  const payload = (await response.json().catch(() => null)) as
    | { id_token?: string; error?: string; error_description?: string }
    | null;

  if (!response.ok || !payload?.id_token) {
    const reason = payload?.error_description || payload?.error || `HTTP ${response.status}`;
    throw new TokenExchangeError(`Token-Austausch fehlgeschlagen (${config.id}): ${reason}`);
  }

  return payload.id_token;
}

export type { OAuthProvider };
