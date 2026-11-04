// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { itemKey } from '../lieferando/item-key';
import { itemKey as agentItemKey } from '../../scripts/lieferando/core.mjs';

/**
 * itemKey живёт в двух копиях: scripts/lieferando/core.mjs (агент на VDS, без
 * TypeScript) и lib/lieferando/item-key.ts (сервер: сверка каталога Hub с
 * сайтом, id Hub-позиций в боте). Разъехавшиеся копии = бот «не находит»
 * позицию, которую сверка считает совпавшей. Сторожим тождество дважды:
 * по исходнику тела функции и по корпусу имён.
 */

const root = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

/** Тело функции без комментариев и пробелов — то, что действительно исполняется. */
function functionBody(source: string): string {
  const m = /export function itemKey\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(source);
  if (!m) throw new Error('itemKey не найден в исходнике');
  return m[1]
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('')
    .replace(/\s+/g, '');
}

describe('itemKey: TS-копия ≡ эталон core.mjs', () => {
  it('тело функции совпадает буквально', () => {
    expect(functionBody(read('lib/lieferando/item-key.ts'))).toBe(
      functionBody(read('scripts/lieferando/core.mjs'))
    );
  });

  it('одинаковые ключи на корпусе имён сайта и Hub', () => {
    const corpus = [
      'Hawaiian',
      'Hawaiian Pizza',
      'Hawaiian Pizza (rund)',
      "Katz's Corner",
      'Katz’s Corner (rund)',
      'Hot Dog Pizza',
      'Hotdog-Pizza',
      "Neu: Fisherman's Slice (Tonno) Pizza",
      'Neu: Sushi Balls Lachs Panko  7stk',
      'Gyoza Gemüse Vegetarische (7 Stück)',
      'Gyoza Gemüse (7 Stück)',
      'Tiger-Drache 340g',
      'Tiger-Drache',
      'Gourmet Pizza (vegetarisch)',
      'Pommes Frites 180g',
      'Fries',
      'Cola 0,33 L',
      'Cola 1,0 L',
      'Veganer Burger mit Beyond Meat-Patty und veganem Cheddar-Käse',
      'Margherita + Cola',
      '',
      undefined,
      null,
      42,
    ];
    for (const name of corpus) expect(itemKey(name)).toBe(agentItemKey(name));
  });
});

describe('itemKey: нормализация (фикс сверки 04.11.2026)', () => {
  it('вес/порция, vegetarisch/vegan, Pommes Frites — одна позиция', () => {
    expect(itemKey('Tiger-Drache')).toBe(itemKey('Tiger-Drache 340g'));
    expect(itemKey('Gourmet Pizza (vegetarisch)')).toBe(itemKey('Gourmet Pizza'));
    expect(itemKey('Gyoza Gemüse (7 Stück)')).toBe(itemKey('Gyoza Gemüse Vegetarische (7 Stück)'));
    expect(itemKey('Pommes Frites')).toBe(itemKey('Fries'));
    expect(itemKey('Pommes Frites')).toBe(itemKey('Pommes Frites 180g'));
    expect(itemKey('Neu: Sushi Balls Lachs Panko  7stk')).toBe(itemKey('Sushi Balls Lachs Panko'));
  });

  it('объём напитков остаётся — 0,33 L ≠ 1,0 L', () => {
    expect(itemKey('Cola 0,33 L')).not.toBe(itemKey('Cola 1,0 L'));
    expect(itemKey('Cola 0,33 L')).toBe(itemKey('Cola 0.33L'));
  });
});
