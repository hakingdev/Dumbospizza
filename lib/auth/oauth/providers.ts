/**
 * Конфигурация внешних провайдеров входа (Google, Apple).
 *
 * Провайдер считается доступным, только если заданы его env-переменные —
 * кнопка на форме входа рисуется по ответу /api/customer/auth/oauth/providers.
 * Так один и тот же код едет на прод и на стенд, где ключей может не быть, и
 * ничего не падает.
 *
 * Все callback-адреса строятся от SITE_URL (канон с www), потому что в консоли
 * Google/Apple redirect_uri сверяется побайтово: apex-версия даст
 * redirect_uri_mismatch. См. lib/site-url.ts.
 */
import { SITE_URL } from '../../site-url';

export type OAuthProvider = 'google' | 'apple';

export const OAUTH_PROVIDERS: OAuthProvider[] = ['google', 'apple'];

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return value === 'google' || value === 'apple';
}

export interface ProviderConfig {
  id: OAuthProvider;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  /** Допустимые значения `iss` в id_token. */
  issuers: string[];
  scope: string;
  clientId: string;
  /**
   * Apple при запросе scope name/email отвечает `response_mode=form_post`:
   * браузер делает КРОСС-САЙТ POST на наш callback. Cookie с SameSite=Lax в
   * таком запросе не отправляется, поэтому транзакционная cookie для Apple
   * должна быть SameSite=None; Secure.
   */
  usesFormPost: boolean;
}

/** Точный redirect_uri — он же должен быть прописан в консоли провайдера. */
export function getRedirectUri(provider: OAuthProvider): string {
  return `${SITE_URL}/api/customer/auth/oauth/${provider}/callback`;
}

function googleConfig(): ProviderConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) return null;
  return {
    id: 'google',
    label: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    scope: 'openid email profile',
    clientId,
    usesFormPost: false,
  };
}

function appleConfig(): ProviderConfig | null {
  const clientId = process.env.APPLE_CLIENT_ID; // Services ID, напр. de.dumbospizza.web
  if (
    !clientId ||
    !process.env.APPLE_TEAM_ID ||
    !process.env.APPLE_KEY_ID ||
    !process.env.APPLE_PRIVATE_KEY
  ) {
    return null;
  }
  return {
    id: 'apple',
    label: 'Apple',
    authorizeUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    issuers: ['https://appleid.apple.com'],
    scope: 'name email',
    clientId,
    usesFormPost: true,
  };
}

/** Конфиг провайдера или null, если он не настроен в этом окружении. */
export function getProviderConfig(provider: OAuthProvider): ProviderConfig | null {
  return provider === 'google' ? googleConfig() : appleConfig();
}

export function isProviderConfigured(provider: OAuthProvider): boolean {
  return getProviderConfig(provider) !== null;
}

/** Список провайдеров, для которых есть ключи — для рендера кнопок. */
export function getEnabledProviders(): { id: OAuthProvider; label: string }[] {
  return OAUTH_PROVIDERS.map(getProviderConfig)
    .filter((c): c is ProviderConfig => c !== null)
    .map((c) => ({ id: c.id, label: c.label }));
}
