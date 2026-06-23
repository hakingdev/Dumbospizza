// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { aggregateFavorites } from '../favorites';

describe('aggregateFavorites', () => {
  it('считает число заказов и суммарное количество товара', () => {
    const orders = [
      { items: [{ product: 'p1', name: 'Margherita', quantity: 1 }] },
      { items: [{ product: 'p1', name: 'Margherita', quantity: 2 }] },
      { items: [{ product: 'p2', name: 'Cola', quantity: 1 }] },
    ];
    const fav = aggregateFavorites(orders);
    expect(fav[0]).toMatchObject({ productId: 'p1', orderCount: 2, totalQuantity: 3 });
    expect(fav[1]).toMatchObject({ productId: 'p2', orderCount: 1, totalQuantity: 1 });
  });

  it('сортирует по числу заказов, затем по количеству', () => {
    const orders = [
      { items: [{ product: 'a', name: 'A', quantity: 5 }] },
      { items: [{ product: 'b', name: 'B', quantity: 1 }] },
      { items: [{ product: 'b', name: 'B', quantity: 1 }] },
    ];
    const fav = aggregateFavorites(orders);
    // b встречается в 2 заказах → выше, хотя количество A больше
    expect(fav[0].productId).toBe('b');
  });

  it('исключает подарочные/акционные позиции', () => {
    const orders = [
      {
        items: [
          { product: 'p1', name: 'Pizza', quantity: 1 },
          { product: 'g1', name: '[GRATIS] Cola', quantity: 1 },
          { product: 'b1', name: '[AKTION] Pizza 2', quantity: 1 },
        ],
      },
    ];
    const fav = aggregateFavorites(orders);
    expect(fav).toHaveLength(1);
    expect(fav[0].productId).toBe('p1');
  });

  it('не считает один товар дважды в рамках одного заказа (orderCount)', () => {
    const orders = [
      {
        items: [
          { product: 'p1', name: 'Pizza', quantity: 1 },
          { product: 'p1', name: 'Pizza', quantity: 1 },
        ],
      },
    ];
    const fav = aggregateFavorites(orders);
    expect(fav[0].orderCount).toBe(1);
    expect(fav[0].totalQuantity).toBe(2);
  });

  it('ограничивает выдачу limit', () => {
    const orders = Array.from({ length: 10 }, (_, i) => ({
      items: [{ product: `p${i}`, name: `P${i}`, quantity: 1 }],
    }));
    expect(aggregateFavorites(orders, 3)).toHaveLength(3);
  });

  it('пустой ввод → пустой результат', () => {
    expect(aggregateFavorites([])).toEqual([]);
  });
});
