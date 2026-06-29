// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizeGermanPhone, parsePhoneRecipients } from '../phone';

describe('normalizeGermanPhone', () => {
  it('normalizes German formats to E.164 (+49…)', () => {
    expect(normalizeGermanPhone('0151 23456789')).toBe('+4915123456789');
    expect(normalizeGermanPhone('0049 151 23456789')).toBe('+4915123456789');
    expect(normalizeGermanPhone('+49 (0)151 2345-6789')).toBe('+49015123456789');
    expect(normalizeGermanPhone('015123456789')).toBe('+4915123456789');
  });

  it('keeps already international numbers', () => {
    expect(normalizeGermanPhone('+4915123456789')).toBe('+4915123456789');
  });

  it('rejects junk and too-short values', () => {
    expect(normalizeGermanPhone('not-a-phone')).toBeNull();
    expect(normalizeGermanPhone('123')).toBeNull();
    expect(normalizeGermanPhone('')).toBeNull();
    expect(normalizeGermanPhone(null)).toBeNull();
  });
});

describe('parsePhoneRecipients', () => {
  it('parses lists, normalizes, dedupes and collects invalid entries', () => {
    const parsed = parsePhoneRecipients([
      '0151 23456789',
      '+4915123456789', // duplicate of the first after normalization
      '0160 1112223',
      'keine-nummer',
    ]);

    expect(parsed.recipients).toEqual(['+4915123456789', '+491601112223']);
    expect(parsed.duplicateCount).toBe(1);
    expect(parsed.invalidEntries).toEqual(['keine-nummer']);
  });
});
