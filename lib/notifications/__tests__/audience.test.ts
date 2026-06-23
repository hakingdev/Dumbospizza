// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { tallyByPhone, isInactive, frequentBuyerPhones } from '../audience';

describe('tallyByPhone', () => {
  it('считает строки по номеру', () => {
    const m = tallyByPhone([
      { phoneNumber: '+491' },
      { phoneNumber: '+491' },
      { phoneNumber: '+492' },
    ]);
    expect(m.get('+491')).toBe(2);
    expect(m.get('+492')).toBe(1);
  });
  it('игнорирует пустые номера', () => {
    const m = tallyByPhone([{ phoneNumber: '' }, { phoneNumber: '+491' }]);
    expect(m.size).toBe(1);
  });
});

describe('isInactive', () => {
  const cutoff = new Date('2026-04-01T00:00:00Z');
  it('true, если последний заказ раньше cutoff', () => {
    expect(isInactive('2026-01-15T00:00:00Z', cutoff)).toBe(true);
  });
  it('false, если заказ позже cutoff', () => {
    expect(isInactive('2026-05-15T00:00:00Z', cutoff)).toBe(false);
  });
  it('false, если заказов не было вовсе (null)', () => {
    expect(isInactive(null, cutoff)).toBe(false);
  });
});

describe('frequentBuyerPhones', () => {
  it('оставляет телефоны с count >= minCount', () => {
    const rows = [
      { phoneNumber: '+491' },
      { phoneNumber: '+491' },
      { phoneNumber: '+491' },
      { phoneNumber: '+492' },
    ];
    const set = frequentBuyerPhones(rows, 2);
    expect(set.has('+491')).toBe(true);
    expect(set.has('+492')).toBe(false);
  });
  it('minCount = 1 берёт всех купивших', () => {
    const set = frequentBuyerPhones([{ phoneNumber: '+492' }], 1);
    expect(set.has('+492')).toBe(true);
  });
});
