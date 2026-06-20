/** Типы акций (Angebote / Aktionen) — единая модель для сайта и приложения. */

export type PromotionType =
  | 'gratis_article'
  | 'percent_discount'
  | 'fixed_discount'
  | 'bogo';

export type PromotionLifecycle = 'active' | 'scheduled' | 'expired';

export type PromotionAudience =
  | 'all'
  | 'new_customers'
  | 'returning'
  | 'vip'
  | 'app_only'
  | 'web_only';

export type PromotionChannel = 'all' | 'web' | 'app';

export type GratisTrigger = 'buy_product' | 'min_order';

export type DiscountScope = 'order' | 'products';

export type BogoMode = 'free' | 'half_price';

export interface PromotionCartItem {
  productId: string;
  categoryId?: string;
  name: string;
  quantity: number;
  /** Цена за единицу (с размером/допами, как в корзине). */
  unitPrice: number;
  /** Название выбранного размера (для таргетинга акций по размеру). */
  sizeName?: string;
}

export interface PromotionLineAdjustment {
  productId: string;
  name: string;
  quantity: number;
  originalUnitPrice: number;
  effectiveLineTotal: number;
  discountAmount: number;
  promotionId: string;
  promotionName: string;
  promotionType: PromotionType;
  label: string;
}

export interface PromotionFreeGift {
  productId: string;
  /** '' / undefined = весь товар (размер не задан). */
  sizeName?: string;
  name: string;
  quantity: number;
  promotionId: string;
  promotionName: string;
  label: string;
}

export interface PromotionFreeGiftOption {
  /** Уникальный ключ опции: productId или `productId|sizeName`. */
  id: string;
  productId: string;
  sizeName?: string;
  name: string;
  image?: string;
}

/** Kunde wählt genau 1 Produkt aus der Liste (Lieferando-Stil). */
export interface PromotionFreeGiftOffer {
  promotionId: string;
  promotionName: string;
  label: string;
  options: PromotionFreeGiftOption[];
}

export interface BogoSecondOption {
  /** Уникальный ключ опции: productId или `productId|sizeName` (для выбора). */
  id: string;
  productId: string;
  sizeName?: string;
  name: string;
  image?: string;
  unitPrice: number;
  /** Was der Kunde zahlt (0 bei gratis, 50 % bei half_price). */
  effectivePrice: number;
}

/** Popup: Kunde wählt 2. Artikel aus der Aktionsliste. */
export interface BogoSecondOffer {
  promotionId: string;
  promotionName: string;
  bogoMode: BogoMode;
  label: string;
  options: BogoSecondOption[];
}

/** Gewählter 2. Artikel — eigene Bestellzeile. */
export interface BogoSecondItem {
  id?: string;
  productId: string;
  sizeName?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  originalUnitPrice: number;
  promotionId: string;
  promotionName: string;
  label: string;
  bogoMode: BogoMode;
}

export interface AppliedPromotionSummary {
  promotionId: string;
  promotionName: string;
  promotionType: PromotionType;
  savedAmount: number;
}

export interface PromotionCalculationResult {
  subtotal: number;
  productDiscountTotal: number;
  orderDiscountTotal: number;
  promotionDiscountTotal: number;
  lineAdjustments: PromotionLineAdjustment[];
  freeGifts: PromotionFreeGift[];
  freeGiftOffers: PromotionFreeGiftOffer[];
  /** Подсказки «осталось докупить до подарка» (min_order, порог не достигнут). */
  giftThresholds?: {
    promotionId: string;
    name: string;
    giftName: string;
    threshold: number;
    remaining: number;
  }[];
  bogoSecondOffers: BogoSecondOffer[];
  bogoSecondItems: BogoSecondItem[];
  appliedPromotions: AppliedPromotionSummary[];
}

export interface PromotionPublicView {
  id: string;
  slug: string;
  name: string;
  description?: string;
  type: PromotionType;
  lifecycle: PromotionLifecycle;
  validFrom: string;
  validTo: string;
  image?: string;
  bannerImage?: string;
  badgeText?: string;
  percentValue?: number;
  fixedValue?: number;
  minOrderAmount?: number;
  bogoMode?: BogoMode;
  scope?: DiscountScope;
  targetProductIds: string[];
  targetCategoryIds: string[];
  targetItems?: { productId: string; sizeName?: string }[];
  rewardItems?: { productId: string; sizeName?: string }[];
  seoTitle?: string;
  seoDescription?: string;
  showInModal: boolean;
  showOnOffersPage: boolean;
  weekdayScheduleEnabled?: boolean;
  happyHourEnabled?: boolean;
  activeDaysOfWeek?: number[];
  activeTimeStart?: string;
  activeTimeEnd?: string;
  scheduleTimeZone?: string;
  weekdayLabel?: string;
  scheduleLabel?: string;
  happyHourActive?: boolean;
}
