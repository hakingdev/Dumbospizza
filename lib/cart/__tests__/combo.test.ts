import { describe, it, expect } from 'vitest';
import { isComboItem, isComboDiscountLine, groupCartRows } from '../combo';

// Eine Kombi = mehrere eigenständige Positionen mit gemeinsamer comboId.
const comboItems = [
  { id: 'c1:pizza-1', name: 'Bayern Pizza', price: 16.9, quantity: 1, comboId: 'c1', comboLabel: 'Matchday-Kombi · 2 Pizzen 30×40', comboRole: 'pizza' as const, size: { name: '30×40' } },
  { id: 'c1:pizza-2', name: 'BBQ Chicken', price: 14.9, quantity: 1, comboId: 'c1', comboLabel: 'Matchday-Kombi · 2 Pizzen 30×40', comboRole: 'pizza' as const, size: { name: '30×40' } },
  { id: 'c1:drink-0', name: 'Coca Cola 0,33l', price: 0, quantity: 1, comboId: 'c1', comboLabel: 'Matchday-Kombi · 2 Pizzen 30×40', comboRole: 'drink' as const },
  { id: 'c1:discount', name: 'Kombi-Rabatt (statt 31,80 €)', price: -5, quantity: 1, comboId: 'c1', comboLabel: 'Matchday-Kombi · 2 Pizzen 30×40', comboRole: 'discount' as const },
];
const normalItem = { id: 'p1', name: 'Margherita', price: 13.9, quantity: 1 };

describe('combo helper — getrennte Positionen, gruppiert', () => {
  it('erkennt Kombi-Positionen anhand comboId', () => {
    expect(isComboItem(comboItems[0])).toBe(true);
    expect(isComboItem(normalItem)).toBe(false);
  });

  it('erkennt die Rabattzeile', () => {
    expect(isComboDiscountLine(comboItems[3])).toBe(true);
    expect(isComboDiscountLine(comboItems[0])).toBe(false);
  });

  it('gruppiert die einzelnen Positionen zu einer Kombi mit korrekter Summe', () => {
    const rows = groupCartRows([...comboItems, normalItem]);
    // 1 Kombi-Gruppe + 1 Einzelartikel
    expect(rows).toHaveLength(2);

    const combo = rows.find((r) => r.kind === 'combo');
    expect(combo).toBeTruthy();
    if (combo?.kind !== 'combo') throw new Error('expected combo');

    // alle 4 Bestandteile bleiben EIGENE Positionen
    expect(combo.items).toHaveLength(4);
    expect(combo.regularTotal).toBeCloseTo(31.8, 2); // 16,90 + 14,90 + 0
    expect(combo.discount).toBeCloseTo(5, 2);
    expect(combo.total).toBeCloseTo(26.8, 2); // Summe = Kombi-Preis

    const single = rows.find((r) => r.kind === 'single');
    expect(single?.kind).toBe('single');
  });

  it('hält die Reihenfolge: Einzelartikel vor Kombi bleibt vorne', () => {
    const rows = groupCartRows([normalItem, ...comboItems]);
    expect(rows[0].kind).toBe('single');
    expect(rows[1].kind).toBe('combo');
  });
});
