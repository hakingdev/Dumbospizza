/** Отображение цены со скидкой на карточках (по бейджам, без полного расчёта корзины). */

export type ProductBadgePricing = {
  type?: string;
  percentValue?: number;
  fixedValue?: number;
  bogoMode?: string;
  happyHourActive?: boolean;
};

export function computePromoDisplayPrice(
  basePrice: number,
  badges: ProductBadgePricing[]
): { promoPrice: number | null; bestPercent: number | null; bogoHint: string | null } {
  let bestPrice = basePrice;
  let hasDiscount = false;
  let bestPercent: number | null = null;
  let bogoHint: string | null = null;

  const activeBadges = badges.filter((b) => b.happyHourActive !== false);

  for (const b of activeBadges) {
    if (b.type === 'bogo') {
      // 2+1: bei 2 gekauften Aktionsartikeln kommt der 3. (vom Restaurant gewählt) dazu.
      bogoHint =
        b.bogoMode === 'half_price'
          ? 'Ab 2 Stück — 3. Artikel zum halben Preis'
          : 'Ab 2 Stück — 3. Artikel gratis';
      continue;
    }
    if (b.type === 'percent_discount' && b.percentValue != null && b.percentValue > 0) {
      const p = basePrice * (1 - b.percentValue / 100);
      if (p < bestPrice) {
        bestPrice = p;
        hasDiscount = true;
        bestPercent = b.percentValue;
      }
    }
    if (b.type === 'fixed_discount' && b.fixedValue != null && b.fixedValue > 0) {
      const p = Math.max(0, basePrice - b.fixedValue);
      if (p < bestPrice) {
        bestPrice = p;
        hasDiscount = true;
      }
    }
  }

  return {
    promoPrice: hasDiscount ? Math.round(bestPrice * 100) / 100 : null,
    bestPercent,
    bogoHint,
  };
}
