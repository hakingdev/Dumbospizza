import type { PromotionDocument } from '../models/promotion.model';
import type {
  PromotionCalculationResult,
  PromotionCartItem,
  AppliedPromotionSummary,
  PromotionFreeGift,
  PromotionFreeGiftOffer,
  PromotionLineAdjustment,
  PromotionChannel,
  PromotionType,
  BogoMode,
} from './types';
import { isPromotionActive, isPromotionEffectivelyActive } from './status';
import { formatHappyHourLabel } from './schedule';
import { matchesAudience, type PromotionCustomerContext } from './audience';
import {
  getGiftProductIds,
  getGiftItems,
  getGiftProductIdSet,
  giftOptionId,
  dedupeFreeGiftsByProduct,
} from './gifts';
import {
  buildBogoSecondOffer,
  bogoSecondItemFromOption,
  bogoRewardSlots,
  BOGO_QUALIFYING_UNITS,
  countEligibleBogoUnits,
  enrichBogoOptionsWithCartPrices,
} from './bogo';
import { normalizeObjectId } from '../normalize-id';
import { isMoneyDiscountType } from './coupon-conflict';
import type { BogoSecondOption, BogoSecondOffer, BogoSecondItem } from './types';

type PromoLike = Pick<
  PromotionDocument,
  | '_id'
  | 'name'
  | 'type'
  | 'enabled'
  | 'validFrom'
  | 'validTo'
  | 'scope'
  | 'percentValue'
  | 'fixedValue'
  | 'minOrderAmount'
  | 'gratisTrigger'
  | 'giftProductId'
  | 'giftProductIds'
  | 'giftProductName'
  | 'bogoMode'
  | 'targetProductIds'
  | 'targetCategoryIds'
  | 'audience'
  | 'channel'
  | 'priority'
  | 'badgeText'
  | 'promoCode'
  | 'happyHourEnabled'
  | 'weekdayScheduleEnabled'
  | 'activeDaysOfWeek'
  | 'activeTimeStart'
  | 'activeTimeEnd'
  | 'scheduleTimeZone'
>;

function promoId(p: PromoLike): string {
  return String(p._id);
}

function matchesChannel(p: PromoLike, channel: PromotionChannel): boolean {
  if (p.channel === 'all') return true;
  return p.channel === channel;
}

function promoMatchesFilters(
  p: PromoLike,
  channel: PromotionChannel,
  customerContext?: PromotionCustomerContext
): boolean {
  return matchesChannel(p, channel) && matchesAudience(p, channel, customerContext);
}

function lineMatchesPromo(line: PromotionCartItem, promo: PromoLike): boolean {
  const lineProductId = String(line.productId);
  const lineCategoryId = normalizeObjectId(line.categoryId);
  const lineSize = (line.sizeName || '').trim();

  // Новый таргетинг по товар+размер (Lieferando)
  const targetItems = (promo as any).targetItems as
    | Array<{ productId?: unknown; sizeName?: unknown }>
    | undefined;
  if (targetItems && targetItems.length > 0) {
    return targetItems.some((it) => {
      if (String(it.productId) !== lineProductId) return false;
      const size = String(it.sizeName || '').trim();
      return size === '' || size === lineSize;
    });
  }

  const productIds = (promo.targetProductIds || []).map(String);
  const categoryIds = (promo.targetCategoryIds || []).map(String);
  if (productIds.length === 0 && categoryIds.length === 0) return true;
  if (productIds.includes(lineProductId)) return true;
  if (lineCategoryId && categoryIds.includes(lineCategoryId)) return true;
  return false;
}

/**
 * Матч товара с акцией для бейджа на карточке каталога — БЕЗ учёта размера.
 * Карточка представляет товар целиком (конкретный размер ещё не выбран), поэтому
 * бейдж нужно показывать, если товар участвует в акции в любом размере.
 * (Точный size-таргетинг применяется позже — в пикере/корзине через lineMatchesPromo.)
 */
function productMatchesPromoForBadge(
  productId: string,
  categoryId: string | undefined,
  promo: PromoLike
): boolean {
  const pid = String(productId);
  const cid = normalizeObjectId(categoryId);

  // Gratis-Artikel: баннер «… GRATIS» — это РЕКЛАМА бесплатного товара, поэтому
  // показываем его ТОЛЬКО на подарочных товарах (giftProductIds), а не на
  // qualifying-товарах. Пустой список подарков → НЕ показываем никому
  // (пустая конфигурация ≠ «все товары»). Это и есть фикс бага «баннер на всех напитках».
  if (promo.type === 'gratis_article') {
    return getGiftProductIdSet(promo as any).includes(pid);
  }

  const targetItems = (promo as any).targetItems as
    | Array<{ productId?: unknown }>
    | undefined;
  if (targetItems && targetItems.length > 0) {
    return targetItems.some((it) => String(it.productId) === pid);
  }

  const productIds = (promo.targetProductIds || []).map(String);
  const categoryIds = (promo.targetCategoryIds || []).map(String);
  if (productIds.length === 0 && categoryIds.length === 0) return true;
  if (productIds.includes(pid)) return true;
  if (cid && categoryIds.includes(cid)) return true;
  return false;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

interface Unit {
  lineIndex: number;
  productId: string;
  name: string;
  unitPrice: number;
}

function expandUnits(items: PromotionCartItem[]): Unit[] {
  const units: Unit[] = [];
  items.forEach((line, lineIndex) => {
    for (let i = 0; i < line.quantity; i++) {
      units.push({
        lineIndex,
        productId: line.productId,
        name: line.name,
        unitPrice: line.unitPrice,
      });
    }
  });
  return units;
}

function computeBogoDiscount(
  items: PromotionCartItem[],
  _promo: PromoLike
): { total: number; perLine: number[] } {
  // Вариант «только попап»: авто-скидки на 2-й товар в корзине нет.
  // Скидка BOGO даётся исключительно через выбор 2-го товара в попапе
  // (из reward-списка) — он добавляется отдельной позицией со скидкой.
  return { total: 0, perLine: items.map(() => 0) };
}

function computeLinePercentFixed(
  line: PromotionCartItem,
  promo: PromoLike
): number {
  const lineTotal = line.unitPrice * line.quantity;
  if (promo.type === 'percent_discount' && promo.percentValue != null) {
    return roundMoney(lineTotal * (promo.percentValue / 100));
  }
  if (promo.type === 'fixed_discount' && promo.fixedValue != null) {
    return roundMoney(Math.min(promo.fixedValue * line.quantity, lineTotal));
  }
  return 0;
}

/** Total savings for one product-level promo across the whole cart. */
function computePromoProductSavings(
  items: PromotionCartItem[],
  promo: PromoLike
): { total: number; perLine: number[] } {
  if (promo.type === 'bogo') {
    return computeBogoDiscount(items, promo);
  }

  const perLine = items.map(() => 0);
  let total = 0;
  items.forEach((line, idx) => {
    if (!lineMatchesPromo(line, promo)) return;
    const saving = computeLinePercentFixed(line, promo);
    if (saving <= 0) return;
    perLine[idx] = saving;
    total += saving;
  });
  return { total: roundMoney(total), perLine: perLine.map(roundMoney) };
}

/** BOGO and %-Rabatt on products are mutually exclusive — pick one winner for the cart. */
function promoTypeRank(type: PromotionType): number {
  switch (type) {
    case 'bogo':
      return 3;
    case 'fixed_discount':
      return 2;
    case 'percent_discount':
      return 1;
    default:
      return 0;
  }
}

function productPromoBeatsCurrent(
  candidate: PromoLike,
  candidateTotal: number,
  current: PromoLike,
  currentTotal: number
): boolean {
  const candidatePriority = candidate.priority ?? 0;
  const currentPriority = current.priority ?? 0;
  if (candidatePriority !== currentPriority) return candidatePriority > currentPriority;

  const candidateRank = promoTypeRank(candidate.type);
  const currentRank = promoTypeRank(current.type);
  if (candidateRank !== currentRank) return candidateRank > currentRank;

  return candidateTotal > currentTotal;
}

function pickBestProductMechanicPerLine(
  items: PromotionCartItem[],
  promos: PromoLike[],
  pickerBogoIds: Set<string> = new Set()
): {
  perLineDiscount: number[];
  perLinePromo: (PromoLike | null)[];
} {
  const productPromos = promos.filter(
    (p) =>
      ((p.type === 'percent_discount' && p.scope === 'products') ||
        p.type === 'fixed_discount' ||
        p.type === 'bogo') &&
      !(p.type === 'bogo' && pickerBogoIds.has(promoId(p)))
  );

  let bestPromo: PromoLike | null = null;
  let bestPerLine = items.map(() => 0);
  let bestTotal = 0;

  for (const promo of productPromos) {
    const { total, perLine } = computePromoProductSavings(items, promo);
    if (total <= 0) continue;

    if (!bestPromo || productPromoBeatsCurrent(promo, total, bestPromo, bestTotal)) {
      bestPromo = promo;
      bestPerLine = perLine;
      bestTotal = total;
    }
  }

  return {
    perLineDiscount: bestPerLine,
    perLinePromo: items.map(() => bestPromo),
  };
}

function labelForPromo(promo: PromoLike): string {
  switch (promo.type) {
    case 'percent_discount':
      return `Rabatt -${promo.percentValue ?? 0} %`;
    case 'fixed_discount':
      return `Rabatt -${promo.fixedValue ?? 0} €`;
    case 'bogo':
      return promo.bogoMode === 'half_price' ? '2+1: 3. Artikel 50 %' : '2+1 Aktion';
    case 'gratis_article':
      return 'Gratis-Artikel';
    default:
      return promo.name;
  }
}

export function calculatePromotions(
  items: PromotionCartItem[],
  promotions: PromoLike[],
  options: {
    channel?: PromotionChannel;
    customerContext?: PromotionCustomerContext;
    now?: Date;
    promoCode?: string;
    selectedBogoSecond?: Array<{ promotionId: string; productId: string }>;
    bogoCatalog?: Record<string, BogoSecondOption[]>;
    /**
     * Подавить ДЕНЕЖНЫЕ акции (percent/fixed/bogo). Используется, когда активен
     * купон: денежная скидка не может комбинироваться с купоном, но Gratis-Artikel
     * остаётся. См. lib/promotions/coupon-conflict.ts.
     */
    excludeMoneyDiscounts?: boolean;
  } = {}
): PromotionCalculationResult {
  const channel = options.channel || 'web';
  const customerContext = options.customerContext;
  const now = options.now || new Date();
  const promoCode = options.promoCode?.trim().toUpperCase();

  const codeFiltered = promotions.filter((p) => {
    const code = (p as PromoLike & { promoCode?: string }).promoCode?.trim().toUpperCase();
    if (code) return promoCode === code;
    return true;
  });

  const subtotal = roundMoney(
    items.reduce((s, l) => s + l.unitPrice * l.quantity, 0)
  );

  const active = codeFiltered.filter(
    (p) =>
      isPromotionEffectivelyActive(p, now) &&
      promoMatchesFilters(p, channel, customerContext) &&
      // Купон активен → денежные акции (percent/fixed/bogo) не применяем, Gratis оставляем.
      !(options.excludeMoneyDiscounts && isMoneyDiscountType(p.type))
  );

  const bogoCatalog = options.bogoCatalog || {};
  // 2+1: награда предлагается, когда куплено >=2 подходящих единиц и настроен
  // каталог награды (1 позиция = фикс от ресторана, 2+ = выбор). Авто-скидки нет —
  // награда добавляется отдельной позицией после подтверждения в попапе.
  const pickerBogoIds = new Set(
    active
      .filter(
        (p) =>
          p.type === 'bogo' &&
          (bogoCatalog[promoId(p)]?.length ?? 0) >= 1 &&
          countEligibleBogoUnits(items, p) >= BOGO_QUALIFYING_UNITS
      )
      .map((p) => promoId(p))
  );

  let { perLineDiscount, perLinePromo } = pickBestProductMechanicPerLine(
    items,
    active,
    pickerBogoIds
  );

  const bogoSecondOffers: BogoSecondOffer[] = [];
  const bogoSecondItems: BogoSecondItem[] = [];

  // Выбор может содержать НЕСКОЛЬКО наград на одну акцию (по одной за пару).
  const selectionsByPromo = new Map<string, string[]>();
  for (const sel of options.selectedBogoSecond || []) {
    const promo = active.find((p) => promoId(p) === sel.promotionId);
    if (!promo || promo.type !== 'bogo') continue;
    const arr = selectionsByPromo.get(sel.promotionId) || [];
    arr.push(sel.productId);
    selectionsByPromo.set(sel.promotionId, arr);
  }

  const pickerPromos = active
    .filter((p) => p.type === 'bogo' && pickerBogoIds.has(promoId(p)))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const promo of pickerPromos) {
    const id = promoId(promo);
    // 2+1: слот награды за КАЖДЫЕ 2 подходящие платные единицы (2→1, 4→2, …),
    // идемпотентно из текущего состояния корзины. Каждый слот клиент подтверждает
    // в попапе (или отказывается) — награду определяет ресторан (rewardItems).
    const allowed = bogoRewardSlots(countEligibleBogoUnits(items, promo));
    if (allowed < 1) continue;

    const catalog = enrichBogoOptionsWithCartPrices(bogoCatalog[id] || [], items, promo.bogoMode);

    // Явно выбранные клиентом награды (по одному на слот), не больше числа единиц.
    const chosenOptions: BogoSecondOption[] = [];
    for (const cid of selectionsByPromo.get(id) || []) {
      if (chosenOptions.length >= allowed) break;
      const opt =
        catalog.find((o) => o.id === cid) || catalog.find((o) => o.productId === cid);
      if (opt) chosenOptions.push(opt);
    }

    // Одинаковые выбранные награды сворачиваем в одну строку с количеством
    // (разные товары — отдельные строки). Это только отображение; число слотов
    // = сумме quantity.
    const perOption = new Map<string, { opt: BogoSecondOption; quantity: number }>();
    for (const opt of chosenOptions) {
      const key = opt.id || opt.productId;
      const entry = perOption.get(key) || { opt, quantity: 0 };
      entry.quantity += 1;
      perOption.set(key, entry);
    }
    for (const { opt, quantity } of Array.from(perOption.values())) {
      bogoSecondItems.push({ ...bogoSecondItemFromOption(promo, opt), quantity });
    }

    // Остались незаполненные слоты → предлагаем выбрать следующую награду (или отказаться).
    const remaining = allowed - chosenOptions.length;
    if (remaining > 0) {
      const offer = buildBogoSecondOffer(promo, bogoCatalog[id] || [], items);
      if (offer) {
        // Квалифицирующие строки корзины — чтобы клиент привязал награду к конкретной
        // пицце (удаление пиццы убирает её награду, а не «случайную»).
        const qualifyingItems = items
          .filter((line) => lineMatchesPromo(line, promo))
          .map((line) => ({
            productId: String(line.productId),
            sizeName: (line.sizeName || '').trim() || undefined,
          }));
        bogoSecondOffers.push({ ...offer, remaining, qualifyingItems });
      }
    }
  }

  // (Вариант «только попап»: блок авто-BOGO при 2+ товарах удалён —
  // скидка идёт исключительно через выбранный в попапе 2-й товар.)

  const lineAdjustments: PromotionLineAdjustment[] = [];
  const appliedMap = new Map<string, AppliedPromotionSummary>();

  items.forEach((line, idx) => {
    const discountAmount = perLineDiscount[idx];
    const promo = perLinePromo[idx];
    if (!promo || discountAmount <= 0) return;

    const lineTotal = line.unitPrice * line.quantity;
    const entry: AppliedPromotionSummary = appliedMap.get(promoId(promo)) || {
      promotionId: promoId(promo),
      promotionName: promo.name,
      promotionType: promo.type,
      savedAmount: 0,
    };
    entry.savedAmount = roundMoney(entry.savedAmount + discountAmount);
    appliedMap.set(promoId(promo), entry);

    lineAdjustments.push({
      productId: line.productId,
      name: line.name,
      quantity: line.quantity,
      originalUnitPrice: line.unitPrice,
      effectiveLineTotal: roundMoney(lineTotal - discountAmount),
      discountAmount,
      promotionId: promoId(promo),
      promotionName: promo.name,
      promotionType: promo.type,
      label: labelForPromo(promo),
    });
  });

  const productDiscountTotal = roundMoney(perLineDiscount.reduce((a, b) => a + b, 0));
  const bogoSecondMerchandise = roundMoney(
    bogoSecondItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  );
  const bogoSecondSavings = roundMoney(
    bogoSecondItems.reduce(
      (s, i) => s + (i.originalUnitPrice - i.unitPrice) * i.quantity,
      0
    )
  );
  const merchandiseAfterProduct = roundMoney(
    subtotal + bogoSecondMerchandise - productDiscountTotal
  );

  for (const item of bogoSecondItems) {
    const entry: AppliedPromotionSummary = appliedMap.get(item.promotionId) || {
      promotionId: item.promotionId,
      promotionName: item.promotionName,
      promotionType: 'bogo',
      savedAmount: 0,
    };
    entry.savedAmount = roundMoney(
      entry.savedAmount + (item.originalUnitPrice - item.unitPrice) * item.quantity
    );
    appliedMap.set(item.promotionId, entry);
  }

  let orderDiscountTotal = 0;
  for (const promo of active) {
    if (promo.type !== 'percent_discount' || promo.scope !== 'order') continue;
    if (promo.minOrderAmount && subtotal < promo.minOrderAmount) continue;
    const minOk = !promo.minOrderAmount || subtotal >= promo.minOrderAmount;
    if (!minOk) continue;
    const amount = roundMoney(merchandiseAfterProduct * ((promo.percentValue || 0) / 100));
    if (amount <= 0) continue;
    orderDiscountTotal = roundMoney(orderDiscountTotal + amount);
    const entry: AppliedPromotionSummary = appliedMap.get(promoId(promo)) || {
      promotionId: promoId(promo),
      promotionName: promo.name,
      promotionType: promo.type,
      savedAmount: 0,
    };
    entry.savedAmount = roundMoney(entry.savedAmount + amount);
    appliedMap.set(promoId(promo), entry);
  }

  const freeGifts: PromotionFreeGift[] = [];
  const freeGiftOffers: PromotionFreeGiftOffer[] = [];
  const giftThresholds: {
    promotionId: string;
    name: string;
    giftName: string;
    threshold: number;
    remaining: number;
  }[] = [];
  for (const promo of active) {
    if (promo.type !== 'gratis_article') continue;

    const giftItems = getGiftItems(promo);
    if (giftItems.length === 0) continue;

    let eligible = false;
    if (promo.gratisTrigger === 'min_order') {
      eligible = promo.minOrderAmount != null && subtotal >= promo.minOrderAmount;
      // подсказка «осталось докупить» когда порог ещё не достигнут
      if (promo.minOrderAmount != null && subtotal < promo.minOrderAmount) {
        giftThresholds.push({
          promotionId: promoId(promo),
          name: promo.name,
          giftName: promo.giftProductName || 'Gratis-Artikel',
          threshold: promo.minOrderAmount,
          remaining: roundMoney(promo.minOrderAmount - subtotal),
        });
      }
    } else if (promo.gratisTrigger === 'buy_product') {
      eligible = items.some((line) => lineMatchesPromo(line, promo) && line.quantity >= 1);
    }

    if (!eligible) continue;

    appliedMap.set(promoId(promo), {
      promotionId: promoId(promo),
      promotionName: promo.name,
      promotionType: promo.type,
      savedAmount: 0,
    });

    if (giftItems.length === 1) {
      const g = giftItems[0];
      freeGifts.push({
        productId: g.productId,
        sizeName: g.sizeName || undefined,
        name: promo.giftProductName || 'Gratis-Artikel',
        quantity: 1,
        promotionId: promoId(promo),
        promotionName: promo.name,
        label: 'Gratis-Artikel',
      });
    } else {
      freeGiftOffers.push({
        promotionId: promoId(promo),
        promotionName: promo.name,
        label: 'Gratis-Artikel — wählen Sie 1 aus',
        options: giftItems.map((g) => ({
          id: giftOptionId(g.productId, g.sizeName),
          productId: g.productId,
          sizeName: g.sizeName || undefined,
          name: promo.giftProductName || 'Gratis-Artikel',
        })),
      });
    }
  }

  const promotionDiscountTotal = roundMoney(
    productDiscountTotal + orderDiscountTotal + bogoSecondSavings
  );

  // «Один физический товар максимум раз»: несколько gratis-акций на один и тот же
  // продукт дают подарок ОДИН раз. Дедупим авто-подарки и убираем из офферов выбора
  // опции на товар, который уже выдан авто-подарком (чтобы пикер не предлагал его).
  const dedupedFreeGifts = dedupeFreeGiftsByProduct(freeGifts);
  const grantedGiftProductIds = new Set(dedupedFreeGifts.map((g) => String(g.productId)));
  const dedupedFreeGiftOffers = freeGiftOffers
    .map((offer) => ({
      ...offer,
      options: offer.options.filter((o) => !grantedGiftProductIds.has(String(o.productId))),
    }))
    .filter((offer) => offer.options.length > 0);

  return {
    subtotal,
    productDiscountTotal,
    orderDiscountTotal,
    promotionDiscountTotal,
    lineAdjustments,
    freeGifts: dedupedFreeGifts,
    freeGiftOffers: dedupedFreeGiftOffers,
    giftThresholds,
    bogoSecondOffers,
    bogoSecondItems,
    appliedPromotions: Array.from(appliedMap.values()),
  };
}

/** Акции для бейджа на карточке товара (без полного расчёта корзины). */
export function getProductPromotionBadges(
  productId: string,
  categoryId: string | undefined,
  promotions: PromoLike[],
  options: { channel?: PromotionChannel; customerContext?: PromotionCustomerContext; now?: Date } = {}
): {
  promotionId: string;
  badgeText: string;
  name: string;
  validTo: Date;
  type: PromotionType;
  percentValue?: number;
  fixedValue?: number;
  bogoMode?: BogoMode;
  scheduleLabel?: string;
  happyHourActive?: boolean;
}[] {
  const channel = options.channel || 'web';
  const customerContext = options.customerContext;
  const now = options.now || new Date();

  return promotions
    .filter(
      (p) =>
        isPromotionEffectivelyActive(p, now) &&
        promoMatchesFilters(p, channel, customerContext) &&
        productMatchesPromoForBadge(productId, categoryId, p)
    )
    .map((p) => ({
      promotionId: promoId(p),
      badgeText:
        p.badgeText ||
        (p.type === 'percent_discount'
          ? `-${p.percentValue ?? 0} %`
          : p.type === 'fixed_discount'
            ? `-${p.fixedValue ?? 0} €`
            : p.type === 'bogo'
              ? p.bogoMode === 'half_price'
                ? '3. 50 %'
                : '2+1'
              : 'GRATIS'),
      name: p.name,
      validTo: p.validTo,
      type: p.type,
      percentValue: p.percentValue,
      fixedValue: p.fixedValue,
      bogoMode: p.bogoMode,
      scheduleLabel: formatHappyHourLabel(p),
      happyHourActive: isPromotionEffectivelyActive(p, now),
    }));
}
