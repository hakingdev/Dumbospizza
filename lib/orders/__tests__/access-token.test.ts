import { describe, it, expect, beforeAll } from 'vitest';
import { signOrderAccessToken, verifyOrderAccessToken } from '../access-token';

describe('order access token (HMAC)', () => {
  beforeAll(() => {
    process.env.ORDER_ACCESS_SECRET = 'test-secret-for-order-tokens';
  });

  it('accepts the token it issued for the same order id', () => {
    const id = '6a4661dac7c541b4257fd31d';
    const token = signOrderAccessToken(id);
    expect(verifyOrderAccessToken(id, token)).toBe(true);
  });

  it('rejects a token issued for a different order id', () => {
    const token = signOrderAccessToken('order-A');
    expect(verifyOrderAccessToken('order-B', token)).toBe(false);
  });

  it('rejects empty, wrong, or tampered tokens', () => {
    const id = 'order-1';
    const token = signOrderAccessToken(id);
    expect(verifyOrderAccessToken(id, '')).toBe(false);
    expect(verifyOrderAccessToken(id, null)).toBe(false);
    expect(verifyOrderAccessToken(id, 'deadbeef')).toBe(false);
    expect(verifyOrderAccessToken(id, token.slice(0, -1) + '0')).toBe(false);
  });

  it('is not guessable from the order id alone (differs per id, hex, 64 chars)', () => {
    const a = signOrderAccessToken('order-1');
    const b = signOrderAccessToken('order-2');
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes when the secret changes (rotation invalidates old tokens)', () => {
    const id = 'order-x';
    const token = signOrderAccessToken(id);
    process.env.ORDER_ACCESS_SECRET = 'a-different-secret';
    expect(verifyOrderAccessToken(id, token)).toBe(false);
    process.env.ORDER_ACCESS_SECRET = 'test-secret-for-order-tokens';
  });
});
