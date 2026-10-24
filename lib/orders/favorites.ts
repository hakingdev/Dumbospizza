/**
 * Вычисление «любимых товаров» клиента по истории заказов.
 * Чистая функция (без БД) — удобно тестировать. Подарочные/акционные позиции
 * ([GRATIS]/[AKTION], нулевая цена) в подсчёт не идут.
 *
 * Агрегация идёт по НОРМАЛИЗОВАННОМУ ИМЕНИ, не по product id: каталог содержит
 * один и тот же товар под несколькими id (квадратная/круглая «Bayern Pizza»,
 * дубли из-за подкатегорий) — ключ по id давал в «Избранном» две неотличимые
 * карточки (QA #12). Все встреченные id складываются в `productIds`, чтобы
 * вызывающий код выбрал живой/доступный для ссылки «Erneut bestellen».
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
  /** Самый частый из встреченных id (обратная совместимость). */
  productId: string;
  /** Все встреченные id товара с этим именем, по убыванию частоты. */
  productIds: string[];
  name: string;
  orderCount: number;
  totalQuantity: number;
}

function isGiftItem(item: { name?: string; totalPrice?: number }): boolean {
  const name = String(item.name || '');
  return name.startsWith('[GRATIS]') || name.startsWith('[AKTION]');
}

/** Ключ слияния: имя без регистра и лишних пробелов. */
export function normalizeFavoriteName(name: string): string {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Топ любимых товаров по числу заказов (затем по суммарному количеству). */
export function aggregateFavorites(
  orders: FavoriteOrderLike[],
  limit = 6
): FavoriteProduct[] {
  const map = new Map<
    string,
    {
      name: string;
      idCounts: Map<string, number>;
      totalQuantity: number;
      _orders: Set<string>;
    }
  >();

  orders.forEach((order, orderIdx) => {
    const seenInOrder = new Set<string>();
    for (const item of order.items || []) {
      if (!item || isGiftItem(item)) continue;
      const name = item.name || String(item.product || '');
      const key = normalizeFavoriteName(name) || String(item.product || '');
      if (!key) continue;
      const qty = Number(item.quantity) || 0;
      if (qty <= 0) continue;

      let entry = map.get(key);
      if (!entry) {
        entry = { name, idCounts: new Map(), totalQuantity: 0, _orders: new Set() };
        map.set(key, entry);
      }
      entry.totalQuantity += qty;
      if (item.product) {
        entry.idCounts.set(item.product, (entry.idCounts.get(item.product) || 0) + 1);
      }
      // orderCount — число РАЗНЫХ заказов с этим товаром (по имени: заказ с
      // квадратной И круглой версией одной пиццы считается один раз)
      if (!seenInOrder.has(key)) {
        entry._orders.add(`${orderIdx}`);
        seenInOrder.add(key);
      }
      if (!entry.name && name) entry.name = name;
    }
  });

  const result = Array.from(map.values()).map((e) => {
    const productIds = Array.from(e.idCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
    return {
      productId: productIds[0] || '',
      productIds,
      name: e.name,
      orderCount: e._orders.size,
      totalQuantity: e.totalQuantity,
    };
  });

  result.sort((a, b) => b.orderCount - a.orderCount || b.totalQuantity - a.totalQuantity);
  return result.slice(0, limit);
}
