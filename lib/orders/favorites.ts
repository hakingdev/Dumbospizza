/**
 * Вычисление «любимых товаров» клиента по истории заказов.
 * Чистая функция (без БД) — удобно тестировать. Подарочные/акционные позиции
 * ([GRATIS]/[AKTION], нулевая цена) в подсчёт не идут.
 */
export interface FavoriteOrderLike {
  items?: Array<{
    product?: string;
    name?: string;
    quantity?: number;
    totalPrice?: number;
  }>;
}

export interface FavoriteProduct {
  productId: string;
  name: string;
  orderCount: number;
  totalQuantity: number;
}

function isGiftItem(item: { name?: string; totalPrice?: number }): boolean {
  const name = String(item.name || '');
  return name.startsWith('[GRATIS]') || name.startsWith('[AKTION]');
}

/** Топ любимых товаров по числу заказов (затем по суммарному количеству). */
export function aggregateFavorites(
  orders: FavoriteOrderLike[],
  limit = 6
): FavoriteProduct[] {
  // ключ — productId (или name как fallback)
  const map = new Map<string, FavoriteProduct & { _orders: Set<unknown> }>();

  orders.forEach((order, orderIdx) => {
    const seenInOrder = new Set<string>();
    for (const item of order.items || []) {
      if (!item || isGiftItem(item)) continue;
      const key = item.product || item.name;
      if (!key) continue;
      const name = item.name || String(item.product);
      const qty = Number(item.quantity) || 0;
      if (qty <= 0) continue;

      let entry = map.get(key);
      if (!entry) {
        entry = {
          productId: item.product || '',
          name,
          orderCount: 0,
          totalQuantity: 0,
          _orders: new Set(),
        };
        map.set(key, entry);
      }
      entry.totalQuantity += qty;
      // orderCount — число РАЗНЫХ заказов с этим товаром
      const orderKey = `${orderIdx}`;
      if (!seenInOrder.has(key)) {
        entry._orders.add(orderKey);
        seenInOrder.add(key);
      }
      if (!entry.name && name) entry.name = name;
    }
  });

  const result = Array.from(map.values()).map((e) => ({
    productId: e.productId,
    name: e.name,
    orderCount: e._orders.size,
    totalQuantity: e.totalQuantity,
  }));

  result.sort((a, b) => b.orderCount - a.orderCount || b.totalQuantity - a.totalQuantity);
  return result.slice(0, limit);
}
