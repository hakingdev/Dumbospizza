import { describe, it, expect } from 'vitest';
import { stripPromoLabels } from '../gift-label';

describe('stripPromoLabels', () => {
  it('entfernt das [GRATIS]-Präfix', () => {
    expect(stripPromoLabels('[GRATIS] Cola 0,33l')).toBe('Cola 0,33l');
  });

  it('entfernt auch das [AKTION]-Präfix (Rabatt)', () => {
    expect(stripPromoLabels('[AKTION] Pizza 2')).toBe('Pizza 2');
  });

  it('entfernt mehrere führende Labels hintereinander', () => {
    expect(stripPromoLabels('[GRATIS] [AKTION] Pizza')).toBe('Pizza');
  });

  it('lässt normale Artikel unverändert', () => {
    expect(stripPromoLabels('Margherita')).toBe('Margherita');
  });

  it('entfernt nur führende Labels, keine Klammern im Namen', () => {
    expect(stripPromoLabels('Pizza (scharf)')).toBe('Pizza (scharf)');
  });

  it('ist robust gegenüber null/undefined', () => {
    expect(stripPromoLabels(undefined as unknown as string)).toBe('');
  });
});
