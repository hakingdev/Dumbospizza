import type {
  PromotionCalculationResult,
  PromotionFreeGift,
  PromotionFreeGiftOffer,
} from './types';

export interface GiftItem {
  productId: string;
  /** '' = весь товар (все размеры). */
  sizeName: string;
}

type GiftPromoLike = {
  giftProductId?: unknown;
  giftProductIds?: unknown[];
  giftItems?: Array<{ productId?: unknown; sizeName?: unknown }>;
  giftProductName?: string;
};

/** Легаси-список productId подарка (giftProductIds / giftProductId). */
export function getGiftProductIds(promo: GiftPromoLike): string[] {
  const fromArray = (promo.giftProductIds || []).map((id) => String(id)).filter(Boolean);
  if (fromArray.length > 0) return fromArray;
  if (promo.giftProductId) return [String(promo.giftProductId)];
  return [];
}

/** Ключ опции подарка: productId или `productId|sizeName`. */
export function giftOptionId(productId: string, sizeName?: string): string {
  return sizeName ? `${productId}|${sizeName}` : String(productId);
}

/**
 * Подарочные позиции (товар+размер). Источник истины — giftItems; если он пуст,
 * фолбэк на легаси giftProductIds (без размеров, sizeName=''). Дедуплицируется.
 */
export function getGiftItems(promo: GiftPromoLike): GiftItem[] {
  const fromItems = (promo.giftItems || [])
    .map((it) => ({ productId: String(it?.productId || ''), sizeName: String(it?.sizeName || '') }))
    .filter((it) => it.productId);

  const source =
    fromItems.length > 0
      ? fromItems
      : getGiftProductIds(promo).map((productId) => ({ productId, sizeName: '' }));

  const seen = new Set<string>();
  const out: GiftItem[] = [];
  for (const it of source) {
    const key = giftOptionId(it.productId, it.sizeName);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/** Уникальные productId подарка — для бейджа/eligibility (без учёта размера). */
export function getGiftProductIdSet(promo: GiftPromoLike): string[] {
  return Array.from(new Set(getGiftItems(promo).map((i) => i.productId)));
}

/** Совпадает ли выбранный ключ с опцией (по id или, для легаси, по productId). */
function optionMatchesSelection(o: { id: string; productId: string }, selected: string): boolean {
  return o.id === selected || o.productId === selected;
}

export function resolveFreeGiftsForOrder(
  calculation: PromotionCalculationResult,
  selections: Array<{ promotionId: string; productId: string }>
): { freeGifts: PromotionFreeGift[]; error?: string } {
  const selectionMap = new Map(selections.map((s) => [s.promotionId, s.productId]));
  const resolved: PromotionFreeGift[] = [...calculation.freeGifts];

  for (const offer of calculation.freeGiftOffers || []) {
    const selected = selectionMap.get(offer.promotionId);
    if (!selected) {
      // Gratis-Artikel sind optional. Ohne Auswahl wird der Geschenk-Offer einfach
      // nicht in die Bestellung übernommen.
      continue;
    }
    const option = offer.options.find((o) => optionMatchesSelection(o, selected));
    if (!option) {
      return { freeGifts: [], error: 'Ungültige Gratis-Auswahl.' };
    }
    resolved.push({
      productId: option.productId,
      sizeName: option.sizeName || undefined,
      name: option.name,
      quantity: 1,
      promotionId: offer.promotionId,
      promotionName: offer.promotionName,
      label: offer.label,
    });
  }

  return { freeGifts: resolved };
}

export function enrichFreeGiftOffers(
  calculation: PromotionCalculationResult,
  productsById: Map<string, { name: string; image?: string }>
): PromotionCalculationResult {
  if (!calculation.freeGiftOffers?.length) return calculation;

  const freeGiftOffers: PromotionFreeGiftOffer[] = calculation.freeGiftOffers
    .map((offer) => ({
      ...offer,
      options: offer.options
        // Отбрасываем опции, чей товар не существует (удалён/битый id) —
        // иначе в списке появлялась фантомная позиция «Gratis-Artikel».
        .filter((opt) => productsById.has(opt.productId))
        .map((opt) => {
          const product = productsById.get(opt.productId)!;
          const baseName = product.name || 'Gratis-Artikel';
          return {
            id: opt.id,
            productId: opt.productId,
            sizeName: opt.sizeName,
            // показываем размер в названии: «Coca Cola 0,33l»
            name: opt.sizeName ? `${baseName} ${opt.sizeName}` : baseName,
            image: product.image || opt.image,
          };
        }),
    }))
    // Если у предложения не осталось валидных опций — не показываем его.
    .filter((offer) => offer.options.length > 0);

  return { ...calculation, freeGiftOffers };
}

/** Nach Auswahl im Popup: Angebot → bestätigtes Gratis-Produkt. */
export function applySelectedFreeGifts(
  calculation: PromotionCalculationResult,
  selections: Array<{ promotionId: string; productId: string }>
): PromotionCalculationResult {
  if (!selections.length || !calculation.freeGiftOffers?.length) {
    return calculation;
  }

  const selectionMap = new Map(selections.map((s) => [s.promotionId, s.productId]));
  const freeGifts = [...calculation.freeGifts];
  const freeGiftOffers: PromotionFreeGiftOffer[] = [];

  for (const offer of calculation.freeGiftOffers) {
    const selected = selectionMap.get(offer.promotionId);
    const option = selected
      ? offer.options.find((o) => optionMatchesSelection(o, selected))
      : undefined;

    if (option) {
      freeGifts.push({
        productId: option.productId,
        sizeName: option.sizeName || undefined,
        name: option.name,
        quantity: 1,
        promotionId: offer.promotionId,
        promotionName: offer.promotionName,
        label: offer.label,
      });
    } else {
      freeGiftOffers.push(offer);
    }
  }

  return { ...calculation, freeGifts, freeGiftOffers };
}
