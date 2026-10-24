import { describe, it, expect } from 'vitest';
import { rankTopUpSuggestions } from '../MinOrderTopUpModal';

const items = [
  { id: 'pizza', price: 12.5 },
  { id: 'dip', price: 0.5 },
  { id: 'cola', price: 2.9 },
  { id: 'tiramisu', price: 4.5 },
  { id: 'water', price: 1.9 },
];

describe('rankTopUpSuggestions', () => {
  it('сначала то, что закрывает недостачу, от самого дешёвого', () => {
    expect(rankTopUpSuggestions(items, 2).map((i) => i.id)).toEqual([
      'cola',
      'tiramisu',
      'pizza',
      'water',
      'dip',
    ]);
  });

  it('ничто не закрывает — ближайшие к недостаче вперёд, с лимитом', () => {
    expect(rankTopUpSuggestions(items, 20, 2).map((i) => i.id)).toEqual(['pizza', 'tiramisu']);
  });
});
