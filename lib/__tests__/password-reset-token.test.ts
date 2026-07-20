// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  generateResetToken,
  hashResetToken,
  resetTokenExpiry,
  RESET_TOKEN_TTL_MINUTES,
} from '../customer-auth';

describe('password reset token', () => {
  it('каждый вызов даёт новый токен', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateResetToken()));
    expect(tokens.size).toBe(50);
  });

  it('токен безопасен для URL (base64url без +/=)', () => {
    expect(generateResetToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('хеш детерминирован', () => {
    const token = generateResetToken();
    expect(hashResetToken(token)).toBe(hashResetToken(token));
  });

  it('в БД уходит ХЕШ, а не сам токен — дамп базы не даёт сбросить пароль', () => {
    const token = generateResetToken();
    const stored = hashResetToken(token);
    expect(stored).not.toBe(token);
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
  });

  it('разные токены дают разные хеши', () => {
    expect(hashResetToken(generateResetToken())).not.toBe(hashResetToken(generateResetToken()));
  });

  it('срок жизни отсчитывается от переданного момента', () => {
    const from = new Date('2026-01-01T12:00:00.000Z');
    expect(resetTokenExpiry(from).toISOString()).toBe('2026-01-01T13:00:00.000Z');
    expect(RESET_TOKEN_TTL_MINUTES).toBe(60);
  });

  it('свежий токен ещё не просрочен', () => {
    expect(resetTokenExpiry().getTime()).toBeGreaterThan(Date.now());
  });
});
