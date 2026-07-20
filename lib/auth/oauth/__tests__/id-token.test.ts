// @vitest-environment node
import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { IdTokenError, parseIdToken } from '../id-token';
import type { ProviderConfig } from '../providers';

const GOOGLE: ProviderConfig = {
  id: 'google',
  label: 'Google',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
  scope: 'openid email profile',
  clientId: 'client-123.apps.googleusercontent.com',
  usesFormPost: false,
};

const APPLE: ProviderConfig = {
  ...GOOGLE,
  id: 'apple',
  label: 'Apple',
  issuers: ['https://appleid.apple.com'],
  clientId: 'de.dumbospizza.web',
  usesFormPost: true,
};

const NONCE = 'nonce-xyz';

/** Подпись не проверяется (см. комментарий в id-token.ts) — секрет любой. */
function makeToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, 'irrelevant-for-decode');
}

function googleToken(overrides: Record<string, unknown> = {}): string {
  return makeToken({
    iss: 'https://accounts.google.com',
    aud: GOOGLE.clientId,
    sub: 'google-sub-1',
    email: 'Kunde@Example.COM',
    email_verified: true,
    name: 'Max Mustermann',
    exp: Math.floor(Date.now() / 1000) + 3600,
    nonce: NONCE,
    ...overrides,
  });
}

describe('parseIdToken — валидный токен', () => {
  it('возвращает личность и приводит email к нижнему регистру', () => {
    const identity = parseIdToken(googleToken(), GOOGLE, NONCE);
    expect(identity).toEqual({
      provider: 'google',
      subject: 'google-sub-1',
      email: 'kunde@example.com',
      emailVerified: true,
      name: 'Max Mustermann',
    });
  });

  it('принимает aud массивом, если наш client_id внутри', () => {
    const token = googleToken({ aud: ['other-app', GOOGLE.clientId] });
    expect(parseIdToken(token, GOOGLE, NONCE).subject).toBe('google-sub-1');
  });

  it('второй допустимый issuer тоже проходит', () => {
    const token = googleToken({ iss: 'accounts.google.com' });
    expect(parseIdToken(token, GOOGLE, NONCE).subject).toBe('google-sub-1');
  });

  it('Apple присылает email_verified строкой "true" — считаем подтверждённым', () => {
    const token = makeToken({
      iss: 'https://appleid.apple.com',
      aud: APPLE.clientId,
      sub: 'apple-sub-1',
      email: 'kunde@privaterelay.appleid.com',
      email_verified: 'true',
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: NONCE,
    });
    const identity = parseIdToken(token, APPLE, NONCE);
    expect(identity.emailVerified).toBe(true);
    expect(identity.provider).toBe('apple');
  });

  it('без email_verified личность считается неподтверждённой', () => {
    const token = googleToken({ email_verified: undefined });
    expect(parseIdToken(token, GOOGLE, NONCE).emailVerified).toBe(false);
  });
});

describe('parseIdToken — отказы', () => {
  it('чужой issuer', () => {
    expect(() => parseIdToken(googleToken({ iss: 'https://evil.example' }), GOOGLE, NONCE)).toThrow(
      IdTokenError
    );
  });

  it('токен, выписанный другому приложению', () => {
    expect(() => parseIdToken(googleToken({ aud: 'other-app' }), GOOGLE, NONCE)).toThrow(
      IdTokenError
    );
  });

  it('просроченный токен', () => {
    const token = googleToken({ exp: Math.floor(Date.now() / 1000) - 3600 });
    expect(() => parseIdToken(token, GOOGLE, NONCE)).toThrow(IdTokenError);
  });

  it('чужой nonce — токен из другого сеанса входа не подходит', () => {
    expect(() => parseIdToken(googleToken({ nonce: 'other-nonce' }), GOOGLE, NONCE)).toThrow(
      IdTokenError
    );
  });

  it('токен вовсе без nonce', () => {
    expect(() => parseIdToken(googleToken({ nonce: undefined }), GOOGLE, NONCE)).toThrow(
      IdTokenError
    );
  });

  it('токен без sub', () => {
    expect(() => parseIdToken(googleToken({ sub: undefined }), GOOGLE, NONCE)).toThrow(
      IdTokenError
    );
  });

  it('мусор вместо JWT', () => {
    expect(() => parseIdToken('not-a-jwt', GOOGLE, NONCE)).toThrow(IdTokenError);
  });

  it('id_token для Google не проходит проверку как Apple (перепутанный провайдер)', () => {
    expect(() => parseIdToken(googleToken(), APPLE, NONCE)).toThrow(IdTokenError);
  });
});
