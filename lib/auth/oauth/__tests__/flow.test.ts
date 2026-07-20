// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildAuthorizeUrl } from '../flow';
import {
  getEnabledProviders,
  getRedirectUri,
  isProviderConfigured,
  type ProviderConfig,
} from '../providers';
import { createTransaction } from '../state';

const GOOGLE: ProviderConfig = {
  id: 'google',
  label: 'Google',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  issuers: ['https://accounts.google.com'],
  scope: 'openid email profile',
  clientId: 'client-123',
  usesFormPost: false,
};

const APPLE: ProviderConfig = {
  ...GOOGLE,
  id: 'apple',
  label: 'Apple',
  authorizeUrl: 'https://appleid.apple.com/auth/authorize',
  issuers: ['https://appleid.apple.com'],
  scope: 'name email',
  clientId: 'de.dumbospizza.web',
  usesFormPost: true,
};

describe('buildAuthorizeUrl', () => {
  it('Google: несёт state, nonce, scope и точный redirect_uri', () => {
    const tx = createTransaction('google', '/checkout');
    const url = new URL(buildAuthorizeUrl(GOOGLE, tx));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('state')).toBe(tx.state);
    expect(url.searchParams.get('nonce')).toBe(tx.nonce);
    expect(url.searchParams.get('redirect_uri')).toBe(getRedirectUri('google'));
  });

  it('Google: просим выбрать аккаунт, а не входить молча последним', () => {
    const url = new URL(buildAuthorizeUrl(GOOGLE, createTransaction('google', null)));
    expect(url.searchParams.get('prompt')).toBe('select_account');
    expect(url.searchParams.get('response_mode')).toBeNull();
  });

  it('Apple: response_mode=form_post — иначе Apple вернёт invalid_request', () => {
    const url = new URL(buildAuthorizeUrl(APPLE, createTransaction('apple', null)));
    expect(url.searchParams.get('response_mode')).toBe('form_post');
    expect(url.searchParams.get('prompt')).toBeNull();
  });

  it('redirect_uri строится от канона с www (иначе redirect_uri_mismatch)', () => {
    expect(getRedirectUri('google')).toBe(
      'https://www.dumbospizza.de/api/customer/auth/oauth/google/callback'
    );
    expect(getRedirectUri('apple')).toBe(
      'https://www.dumbospizza.de/api/customer/auth/oauth/apple/callback'
    );
  });
});

describe('гейтинг провайдеров по env', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.APPLE_CLIENT_ID;
    delete process.env.APPLE_TEAM_ID;
    delete process.env.APPLE_KEY_ID;
    delete process.env.APPLE_PRIVATE_KEY;
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('без ключей кнопок нет — форма входа выглядит как раньше', () => {
    expect(getEnabledProviders()).toEqual([]);
    expect(isProviderConfigured('google')).toBe(false);
    expect(isProviderConfigured('apple')).toBe(false);
  });

  it('половина ключей Google не включает провайдера', () => {
    process.env.GOOGLE_CLIENT_ID = 'id-only';
    expect(isProviderConfigured('google')).toBe(false);
  });

  it('полный набор Google включает только Google', () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    expect(getEnabledProviders()).toEqual([{ id: 'google', label: 'Google' }]);
  });

  it('Apple требует все четыре переменные', () => {
    process.env.APPLE_CLIENT_ID = 'de.dumbospizza.web';
    process.env.APPLE_TEAM_ID = 'TEAM';
    process.env.APPLE_KEY_ID = 'KEY';
    expect(isProviderConfigured('apple')).toBe(false);

    process.env.APPLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nx\\n-----END PRIVATE KEY-----';
    expect(isProviderConfigured('apple')).toBe(true);
  });
});
