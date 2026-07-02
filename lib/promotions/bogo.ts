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

/** 2+1: сколько подходящих единиц нужно КУПИТЬ за одну награду. */
export const BOGO_QUALIFYING_UNITS = 2;

/** Число слотов награды: 1 за каждые 2 купленные подходящие единицы (2→1, 4→2, …). */
export function bogoRewardSlots(eligibleUnits: number): number {
  return Math.floor(eligibleUnits / BOGO_QUALIFYING_UNITS);
}

/** Награда настроена (rewardItems → каталог): 1 позиция = фикс от ресторана, 2+ = выбор из списка. */
export function bogoHasRewardCatalog(catalog: BogoSecondOption[] | undefined): boolean {
  return (catalog?.length ?? 0) >= 1;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
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
    ? '2+1 Aktion: 3. Artikel zum halben Preis'
    : '2+1 Aktion: 3. Artikel gratis';
}

export function buildBogoSecondOffer(
  promo: BogoPromoLike,
  catalog: BogoSecondOption[],
  items: PromotionCartItem[] = []
): BogoSecondOffer | null {
  const mode = promo.bogoMode || 'free';
  if (!bogoHasRewardCatalog(catalog)) return null;

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
    label: mode === 'half_price' ? '3. Artikel 50 %' : '3. Artikel gratis',
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
      return { error: 'Ungültige Auswahl für die 2+1 Aktion.' };
    }
  }
  return {};
}
