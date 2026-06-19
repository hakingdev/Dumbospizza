import type {
  PromotionCalculationResult,
  PromotionFreeGift,
  PromotionFreeGiftOffer,
} from './types';

type GiftPromoLike = {
  giftProductId?: unknown;
  giftProductIds?: unknown[];
  giftProductName?: string;
};

export function getGiftProductIds(promo: GiftPromoLike): string[] {
  const fromArray = (promo.giftProductIds || [])
    .map((id) => String(id))
    .filter(Boolean);
  if (fromArray.length > 0) return fromArray;
  if (promo.giftProductId) return [String(promo.giftProductId)];
  return [];
}

export function resolveFreeGiftsForOrder(
  calculation: PromotionCalculationResult,
  selections: Array<{ promotionId: string; productId: string }>
): { freeGifts: PromotionFreeGift[]; error?: string } {
  const selectionMap = new Map(selections.map((s) => [s.promotionId, s.productId]));
  const resolved: PromotionFreeGift[] = [...calculation.freeGifts];

  for (const offer of calculation.freeGiftOffers || []) {
    const productId = selectionMap.get(offer.promotionId);
    if (!productId) {
      return { freeGifts: [], error: 'Bitte wählen Sie Ihr Gratis-Produkt aus.' };
    }
    const option = offer.options.find((o) => o.productId === productId);
    if (!option) {
      return { freeGifts: [], error: 'Ungültige Gratis-Auswahl.' };
    }
    resolved.push({
      productId,
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

  const freeGiftOffers: PromotionFreeGiftOffer[] = calculation.freeGiftOffers.map((offer) => ({
    ...offer,
    options: offer.options.map((opt) => {
      const product = productsById.get(opt.productId);
      return {
        productId: opt.productId,
        name: product?.name || opt.name || 'Gratis-Artikel',
        image: product?.image || opt.image,
      };
    }),
  }));

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
    const productId = selectionMap.get(offer.promotionId);
    const option = productId ? offer.options.find((o) => o.productId === productId) : undefined;

    if (option) {
      freeGifts.push({
        productId: option.productId,
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
