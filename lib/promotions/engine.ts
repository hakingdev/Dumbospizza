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
import { getGiftProductIds } from './gifts';
import {
  buildBogoSecondOffer,
  bogoSecondItemFromOption,
  bogoNeedsPicker,
  countEligibleBogoUnits,
  enrichBogoOptionsWithCartPrices,
} from './bogo';
import { normalizeObjectId } from '../normalize-id';
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
      return promo.bogoMode === 'half_price' ? '2. Artikel 50 %' : '2 für 1 Aktion';
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
      isPromotionEffectivelyActive(p, now) && promoMatchesFilters(p, channel, customerContext)
  );

  const bogoCatalog = options.bogoCatalog || {};
  // «Только попап»: предлагаем выбор 2-го товара всегда, когда есть хотя бы один
  // подходящий товар в корзине и каталог награды (>=2 опций). Авто-скидки нет.
  const pickerBogoIds = new Set(
    active
      .filter(
        (p) =>
          p.type === 'bogo' &&
          (bogoCatalog[promoId(p)]?.length ?? 0) >= 2 &&
          countEligibleBogoUnits(items, p) >= 1
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
    // одна награда на каждую подходящую единицу товара (per item)
    const allowed = countEligibleBogoUnits(items, promo);
    if (allowed < 1) continue;

    const catalog = enrichBogoOptionsWithCartPrices(bogoCatalog[id] || [], items, promo.bogoMode);
    const chosenIds = (selectionsByPromo.get(id) || []).slice(0, allowed);

    let resolved = 0;
    for (const cid of chosenIds) {
      const opt =
        catalog.find((o) => o.id === cid) || catalog.find((o) => o.productId === cid);
      if (opt) {
        bogoSecondItems.push(bogoSecondItemFromOption(promo, opt));
        resolved++;
      }
    }

    // остались незаполненные слоты — показываем попап для выбора следующей награды
    if (resolved < allowed) {
      const offer = buildBogoSecondOffer(promo, bogoCatalog[id] || [], items);
      if (offer) bogoSecondOffers.push(offer);
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

    const giftIds = getGiftProductIds(promo);
    if (giftIds.length === 0) continue;

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

    if (giftIds.length === 1) {
      freeGifts.push({
        productId: giftIds[0],
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
        options: giftIds.map((productId) => ({
          productId,
          name: promo.giftProductName || 'Gratis-Artikel',
        })),
      });
    }
  }

  const promotionDiscountTotal = roundMoney(
    productDiscountTotal + orderDiscountTotal + bogoSecondSavings
  );

  return {
    subtotal,
    productDiscountTotal,
    orderDiscountTotal,
    promotionDiscountTotal,
    lineAdjustments,
    freeGifts,
    freeGiftOffers,
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
  const line: PromotionCartItem = {
    productId,
    categoryId,
    name: '',
    quantity: 1,
    unitPrice: 0,
  };

  return promotions
    .filter(
      (p) =>
        isPromotionEffectivelyActive(p, now) &&
        promoMatchesFilters(p, channel, customerContext) &&
        lineMatchesPromo(line, p)
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
                ? '2. 50 %'
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
