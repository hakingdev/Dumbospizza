import type {
  PromotionCartItem,
  BogoSecondOffer,
  BogoSecondOption,
  BogoSecondItem,
  BogoMode,
  PromotionCalculationResult,
} from './types';
import { normalizeObjectId } from '../normalize-id';

type PromoTargetItem = { productId?: unknown; sizeName?: unknown };

type BogoPromoLike = {
  _id?: unknown;
  name?: string;
  bogoMode?: BogoMode;
  targetProductIds?: unknown[];
  targetCategoryIds?: unknown[];
  targetItems?: PromoTargetItem[];
};

function lineMatchesPromo(line: PromotionCartItem, promo: BogoPromoLike): boolean {
  const lineProductId = String(line.productId);
  const lineCategoryId = normalizeObjectId(line.categoryId);
  const lineSize = (line.sizeName || '').trim();

  // Новый таргетинг по товар+размер (Lieferando)
  const targetItems = promo.targetItems || [];
  if (targetItems.length > 0) {
    return targetItems.some((it) => {
      if (String(it.productId) !== lineProductId) return false;
      const size = String(it.sizeName || '').trim();
      return size === '' || size === lineSize; // пустой размер = любой
    });
  }

  // Легаси: товар/категория целиком
  const productIds = (promo.targetProductIds || []).map(String);
  const categoryIds = (promo.targetCategoryIds || []).map(String);
  if (productIds.length === 0 && categoryIds.length === 0) return true;
  if (productIds.includes(lineProductId)) return true;
  if (lineCategoryId && categoryIds.includes(lineCategoryId)) return true;
  return false;
}

export function countEligibleBogoUnits(
  items: PromotionCartItem[],
  promo: BogoPromoLike
): number {
  return items.reduce((sum, line) => {
    if (!lineMatchesPromo(line, promo)) return sum;
    return sum + line.quantity;
  }, 0);
}

export function bogoUsesPicker(catalog: BogoSecondOption[] | undefined): boolean {
  return (catalog?.length ?? 0) >= 2;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Picker only with exactly 1 eligible item (Lieferando: choose 2nd product). 2+ items → auto BOGO pairs in cart. */
export function bogoNeedsPicker(
  items: PromotionCartItem[],
  promo: BogoPromoLike,
  catalog: BogoSecondOption[] | undefined
): boolean {
  return bogoUsesPicker(catalog) && countEligibleBogoUnits(items, promo) === 1;
}

/** Use cart line price when the same product is already in the cart (size/extras). */
export function enrichBogoOptionsWithCartPrices(
  options: BogoSecondOption[],
  items: PromotionCartItem[],
  mode: BogoMode | undefined
): BogoSecondOption[] {
  return options.map((opt) => {
    // Для размерных опций нельзя фолбэчиться на "любой размер" того же товара:
    // иначе все размеры в BOGO-пикере наследуют цену выбранной в корзине пиццы.
    const cartLine = opt.sizeName
      ? items.find(
          (line) =>
            String(line.productId) === opt.productId &&
            (line.sizeName || '').trim() === opt.sizeName
        )
      : items.find((line) => String(line.productId) === opt.productId);
    const unitPrice = cartLine?.unitPrice ?? opt.unitPrice;
    return {
      ...opt,
      unitPrice,
      effectivePrice: mode === 'half_price' ? roundMoney(unitPrice * 0.5) : 0,
    };
  });
}

function labelForBogoMode(mode: BogoMode | undefined): string {
  return mode === 'half_price'
    ? '2. Artikel zum halben Preis — bitte wählen'
    : '2. Artikel gratis — bitte wählen';
}

export function buildBogoSecondOffer(
  promo: BogoPromoLike,
  catalog: BogoSecondOption[],
  items: PromotionCartItem[] = []
): BogoSecondOffer | null {
  const mode = promo.bogoMode || 'free';
  if (!bogoUsesPicker(catalog)) return null;

  return {
    promotionId: String(promo._id),
    promotionName: promo.name || 'Aktion',
    bogoMode: mode,
    label: labelForBogoMode(mode),
    options: enrichBogoOptionsWithCartPrices(catalog, items, mode),
  };
}

export function bogoSecondItemFromOption(
  promo: BogoPromoLike,
  option: BogoSecondOption
): BogoSecondItem {
  const mode = promo.bogoMode || 'free';
  return {
    id: option.id,
    productId: option.productId,
    sizeName: option.sizeName,
    name: option.name,
    quantity: 1,
    unitPrice: option.effectivePrice,
    originalUnitPrice: option.unitPrice,
    promotionId: String(promo._id),
    promotionName: promo.name || 'Aktion',
    label: mode === 'half_price' ? '2. Artikel 50 %' : '2. Artikel gratis',
    bogoMode: mode,
  };
}

export function validateBogoSecondSelection(
  calculation: Pick<PromotionCalculationResult, 'bogoSecondOffers'>,
  selections: Array<{ promotionId: string; productId: string }>
): { error?: string } {
  const selectionMap = new Map(selections.map((s) => [s.promotionId, s.productId]));
  for (const offer of calculation.bogoSecondOffers || []) {
    const productId = selectionMap.get(offer.promotionId);
    // Награда опциональна (вариант «только попап»): нет выбора — клиент отказался, это ок.
    if (!productId) continue;
    if (!offer.options.some((o) => o.id === productId || o.productId === productId)) {
      return { error: 'Ungültige Auswahl für die 2-für-1 Aktion.' };
    }
  }
  return {};
}

export function resolveBogoSecondItems(
  calculation: PromotionCalculationResult,
  selections: Array<{ promotionId: string; productId: string }>,
  promosById: Map<string, BogoPromoLike>
): BogoSecondItem[] {
  const resolved = [...calculation.bogoSecondItems];
  const selectionMap = new Map(selections.map((s) => [s.promotionId, s.productId]));

  for (const offer of calculation.bogoSecondOffers || []) {
    const selectedId = selectionMap.get(offer.promotionId);
    if (!selectedId) continue;
    const option =
      offer.options.find((o) => o.id === selectedId) ||
      offer.options.find((o) => o.productId === selectedId);
    if (!option) continue;
    const promo = promosById.get(offer.promotionId);
    if (!promo) continue;
    resolved.push(bogoSecondItemFromOption(promo, option));
  }

  return resolved;
}
