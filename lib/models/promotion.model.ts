import { createModel } from '../db/mongoose-compat';
import { promotions } from '../db/schema';
import type {
  PromotionType,
  PromotionAudience,
  PromotionChannel,
  GratisTrigger,
  DiscountScope,
  BogoMode,
} from '../promotions/types';

export interface PromotionDocument {
  _id: string;
  id?: string;
  name: string;
  internalName?: string;
  description?: string;
  slug: string;
  type: PromotionType;
  enabled: boolean;
  validFrom: Date;
  validTo: Date;
  scope?: DiscountScope;
  percentValue?: number;
  fixedValue?: number;
  minOrderAmount?: number;
  gratisTrigger?: GratisTrigger;
  giftProductId?: string;
  giftProductName?: string;
  /** Mehrere Gratis-Artikel — Kunde wählt genau einen aus. */
  giftProductIds: string[];
  bogoMode?: BogoMode;
  targetProductIds: string[];
  targetCategoryIds: string[];
  /** Квалифицирующие позиции на уровне товар+размер (Lieferando). sizeName пустой = весь товар. */
  targetItems: { productId: string; sizeName?: string }[];
  /** Награда (2-й товар за полцены/бесплатно) на уровне товар+размер. */
  rewardItems: { productId: string; sizeName?: string }[];
  audience: PromotionAudience;
  channel: PromotionChannel;
  image?: string;
  bannerImage?: string;
  seoTitle?: string;
  seoDescription?: string;
  ogImage?: string;
  badgeText?: string;
  /** Optional promo code — акция применяется только при вводе кода (слой поверх auto-акций). */
  promoCode?: string;
  showInModal: boolean;
  showOnOffersPage: boolean;
  priority: number;
  usageCount: number;
  viewCount: number;
  modalOpenCount: number;
  clickCount: number;
  orderCount: number;
  revenueTotal: number;
  /** Happy Hour — скидка только в указанном окне */
  weekdayScheduleEnabled: boolean;
  happyHourEnabled: boolean;
  activeDaysOfWeek: number[];
  activeTimeStart?: string;
  activeTimeEnd?: string;
  scheduleTimeZone?: string;
  autoNotifyOnStart: boolean;
  lastAutoNotifyAt?: Date;
  /** Email-Kampagne */
  emailCampaignEnabled: boolean;
  emailSubject?: string;
  emailBodyHtml?: string;
  emailSentAt?: Date;
  emailSentCount: number;
  /** Push-Kampagne (FCM) */
  pushCampaignEnabled: boolean;
  pushTitle?: string;
  pushBody?: string;
  pushSentAt?: Date;
  pushSentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export const Promotion = createModel(promotions);

export default Promotion;
