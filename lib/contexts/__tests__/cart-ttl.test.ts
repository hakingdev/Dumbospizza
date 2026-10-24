import { describe, it, expect } from 'vitest';
import { CART_TTL_MS, isSavedCartExpired } from '../CartContext';

/**
 * QA #8: наполненная, но не оформленная корзина не должна жить вечно —
 * она тянет за собой скидки/акции/купоны, которых уже нет. Отсчёт TTL идёт
 * от последнего изменения СОСТАВА (cartTouchedAt), не от визитов на сайт.
 */
describe('isSavedCartExpired (TTL брошенной корзины)', () => {
  const NOW = 1_700_000_000_000;
  const items = [{ id: 'p1', productId: 'p1', name: 'Bayern', quantity: 2, price: 10 }];

  it('свежая корзина (моложе TTL) живёт', () => {
    expect(
      isSavedCartExpired({ items, cartTouchedAt: NOW - CART_TTL_MS + 60_000 }, NOW)
    ).toBe(false);
  });

  it('корзина старше TTL с товарами — просрочена', () => {
    expect(
      isSavedCartExpired({ items, cartTouchedAt: NOW - CART_TTL_MS - 60_000 }, NOW)
    ).toBe(true);
  });

  it('пустая корзина не просрочивается (нечего сбрасывать)', () => {
    expect(
      isSavedCartExpired({ items: [], cartTouchedAt: NOW - CART_TTL_MS * 30 }, NOW)
    ).toBe(false);
  });

  it('легаси-запись без штампа не считается просроченной (штамп появится при первом сохранении)', () => {
    expect(isSavedCartExpired({ items }, NOW)).toBe(false);
    expect(isSavedCartExpired({ items, cartTouchedAt: 'мусор' }, NOW)).toBe(false);
  });

  it('робастность к null/undefined/битому JSON-объекту', () => {
    expect(isSavedCartExpired(null, NOW)).toBe(false);
    expect(isSavedCartExpired(undefined, NOW)).toBe(false);
    expect(isSavedCartExpired({ cartTouchedAt: NOW - CART_TTL_MS * 2, items: 'не массив' }, NOW)).toBe(false);
  });
});
