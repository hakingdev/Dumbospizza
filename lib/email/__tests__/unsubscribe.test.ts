// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  makeUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
} from '../unsubscribe';

describe('unsubscribe tokens', () => {
  it('round-trips an email and normalizes case', () => {
    const token = makeUnsubscribeToken('Kunde@Example.com');
    expect(verifyUnsubscribeToken(token)).toBe('kunde@example.com');
  });

  it('rejects tampered or malformed tokens', () => {
    const token = makeUnsubscribeToken('kunde@example.com');
    expect(verifyUnsubscribeToken(token + 'x')).toBeNull();
    expect(verifyUnsubscribeToken('garbage')).toBeNull();
    expect(verifyUnsubscribeToken('')).toBeNull();
  });

  it('rejects a token whose email payload was swapped (signature mismatch)', () => {
    const token = makeUnsubscribeToken('victim@example.com');
    const [, sig] = token.split('.', 2);
    const forgedPayload = Buffer.from('attacker@example.com').toString('base64url');
    expect(verifyUnsubscribeToken(`${forgedPayload}.${sig}`)).toBeNull();
  });

  it('builds a full unsubscribe URL with the token', () => {
    const url = buildUnsubscribeUrl('https://dumbospizza.de', 'kunde@example.com');
    expect(url).toContain('https://dumbospizza.de/api/email/unsubscribe?token=');
    const token = decodeURIComponent(url.split('token=')[1]);
    expect(verifyUnsubscribeToken(token)).toBe('kunde@example.com');
  });
});
