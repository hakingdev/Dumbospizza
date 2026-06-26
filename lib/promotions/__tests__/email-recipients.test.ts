// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  MAX_MANUAL_EMAIL_RECIPIENTS,
  normalizeEmailRecipient,
  parseEmailRecipients,
} from '../email-recipients';

describe('parseEmailRecipients', () => {
  it('splits pasted lists, normalizes case, removes duplicates and keeps invalid entries', () => {
    const parsed = parseEmailRecipients(`
      Alice@Example.com
      bob@example.de; alice@example.com, invalid-address
      Customer <carol@example.org>
    `);

    expect(parsed.recipients).toEqual([
      'alice@example.com',
      'bob@example.de',
      'carol@example.org',
    ]);
    expect(parsed.invalidEntries).toEqual(['invalid-address']);
    expect(parsed.duplicateCount).toBe(1);
    expect(parsed.entryCount).toBe(5);
    expect(parsed.truncated).toBe(false);
  });

  it('accepts spreadsheet-like cell arrays', () => {
    const parsed = parseEmailRecipients([
      'First column',
      'MAILTO:team@example.com',
      'Team <team@example.com>',
      'info@example.com.',
    ]);

    expect(parsed.recipients).toEqual(['team@example.com', 'info@example.com']);
    expect(parsed.invalidEntries).toEqual(['First column']);
    expect(parsed.duplicateCount).toBe(1);
  });

  it('limits manual recipient lists to the configured maximum', () => {
    const input = Array.from(
      { length: MAX_MANUAL_EMAIL_RECIPIENTS + 2 },
      (_, index) => `person-${index}@example.com`
    );

    const parsed = parseEmailRecipients(input);

    expect(parsed.recipients).toHaveLength(MAX_MANUAL_EMAIL_RECIPIENTS);
    expect(parsed.truncated).toBe(true);
    expect(parsed.recipients.at(-1)).toBe(`person-${MAX_MANUAL_EMAIL_RECIPIENTS - 1}@example.com`);
  });
});

describe('normalizeEmailRecipient', () => {
  it('returns null for non-email values', () => {
    expect(normalizeEmailRecipient('not-an-email')).toBeNull();
    expect(normalizeEmailRecipient('')).toBeNull();
    expect(normalizeEmailRecipient(null)).toBeNull();
  });
});
