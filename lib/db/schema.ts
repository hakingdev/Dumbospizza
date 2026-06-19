/**
 * Drizzle-схема Postgres (Supabase) — перенос всех Mongoose-моделей dumbospizza.
 *
 * Соглашения:
 *  - id: text с форматом MongoDB ObjectId (см. lib/db/object-id.ts) — перенос данных 1:1.
 *  - денежные/числовые поля (Number в Mongoose) → doublePrecision, чтобы код получал JS number.
 *  - счётчики/порядок → integer.
 *  - вложенные документы и массивы-ссылки → jsonb (форма данных совпадает с тем, что отдаёт приложение).
 *  - timestamps: created_at/updated_at timestamptz; updated_at авто-обновляется ($onUpdate).
 */
import {
  pgTable,
  text,
  boolean,
  integer,
  doublePrecision,
  bigint,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { genObjectId } from './object-id';

// ---- переиспользуемые билдеры ----
const id = () => text('id').primaryKey().$defaultFn(genObjectId);

const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());

// =====================================================================
// Categories
// =====================================================================
export const categories = pgTable(
  'categories',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    image: text('image').default('/images/default-category.jpg'),
    icon: text('icon'),
    active: boolean('active').notNull().default(true),
    order: integer('order').notNull().default(0),
    mewsProductTypeId: text('mews_product_type_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    slugUq: uniqueIndex('categories_slug_uq').on(t.slug),
    mewsTypeIdx: index('categories_mews_type_idx').on(t.mewsProductTypeId),
  })
);

// =====================================================================
// Products
// =====================================================================
export const products = pgTable(
  'products',
  {
    id: id(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    category: text('category').notNull(), // ref categories.id
    basePrice: doublePrecision('base_price').notNull(),
    image: text('image').default('/images/default-product.jpg'),
    available: boolean('available').notNull().default(true),
    featured: boolean('featured').notNull().default(false),
    valentinePromo: boolean('valentine_promo').notNull().default(false),
    taxRate: doublePrecision('tax_rate').notNull().default(0),
    mewsProductId: text('mews_product_id'),
    mewsProductTypeId: text('mews_product_type_id'),
    mewsSku: text('mews_sku'),
    mewsProductVariantIds: jsonb('mews_product_variant_ids')
      .$type<string[]>()
      .notNull()
      .default([]),
    mewsModifierSetIds: jsonb('mews_modifier_set_ids')
      .$type<string[]>()
      .notNull()
      .default([]),
    /** @deprecated вшитые опции — заменены на optionGroupIds */
    extras: jsonb('extras').$type<{
      toppings?: { name: string; price: number }[];
      sauces?: { name: string; price: number }[];
      sides?: { name: string; price: number }[];
    } | null>(),
    optionGroupIds: jsonb('option_group_ids').$type<string[]>().notNull().default([]),
    sizes: jsonb('sizes')
      .$type<
        {
          id: string;
          variationId?: string | null;
          name: string;
          label: string;
          price: number;
          size?: string;
          priceModifier?: number;
        }[]
      >()
      .notNull()
      .default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    categoryIdx: index('products_category_idx').on(t.category),
    mewsProductIdx: index('products_mews_product_idx').on(t.mewsProductId),
  })
);

// =====================================================================
// Orders
// =====================================================================
type OrderItem = {
  product: string;
  name: string;
  quantity: number;
  price: number;
  size?: { id: string; name: string; size: string; price: number };
  extras?: {
    toppings?: { id: string; name: string; price: number }[];
    sauces?: { id: string; name: string; price: number }[];
    sides?: { id: string; name: string; price: number }[];
  };
  options?: { groupId?: string; group: string; name: string; price: number }[];
  totalPrice: number;
};

export const orders = pgTable(
  'orders',
  {
    id: id(),
    orderNumber: text('order_number'),
    user: text('user'), // ref users.id
    customerName: text('customer_name').notNull(),
    phoneNumber: text('phone_number').notNull(),
    email: text('email'),
    items: jsonb('items').$type<OrderItem[]>().notNull().default([]),
    deliveryAddress: jsonb('delivery_address').$type<{
      street: string;
      houseNumber: string;
      postalCode: string;
      city: string;
      floor?: string;
      notes?: string;
    } | null>(),
    deliveryZone: jsonb('delivery_zone').$type<{
      id: string;
      name: string;
      minOrderAmount: number;
    } | null>(),
    deliveryType: text('delivery_type').notNull(), // 'delivery' | 'pickup'
    deliveryFee: doublePrecision('delivery_fee').notNull().default(0),
    subtotal: doublePrecision('subtotal').notNull(),
    tax: doublePrecision('tax').notNull().default(0),
    discount: jsonb('discount').$type<{
      code?: string;
      amount: number;
      type: 'percentage' | 'fixed';
    } | null>(),
    promotionDiscount: doublePrecision('promotion_discount').notNull().default(0),
    promotionPromoCode: text('promotion_promo_code'),
    appliedPromotions: jsonb('applied_promotions')
      .$type<{ promotionId: string; name: string; type: string; savedAmount: number }[]>()
      .notNull()
      .default([]),
    freeGifts: jsonb('free_gifts')
      .$type<
        { productId: string; name: string; quantity: number; promotionId: string; label?: string }[]
      >()
      .notNull()
      .default([]),
    loyaltyPointsUsed: integer('loyalty_points_used'),
    loyaltyPointsEarned: integer('loyalty_points_earned'),
    total: doublePrecision('total').notNull(),
    paymentMethod: text('payment_method').notNull(), // 'cash' | 'card' | 'online'
    paymentStatus: text('payment_status').notNull().default('pending'),
    status: text('status').notNull().default('new'),
    notes: text('notes'),
    desiredDeliveryTime: text('desired_delivery_time'),
    telegramMessageId: bigint('telegram_message_id', { mode: 'number' }),
    mewsOrderId: text('mews_order_id'),
    kitchenPrintStatus: text('kitchen_print_status').default('pending'),
    customerPrintStatus: text('customer_print_status').default('pending'),
    statusUpdates: jsonb('status_updates')
      .$type<{ status: string; timestamp: string; updatedBy?: string }[]>()
      .notNull()
      .default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    orderNumberUq: uniqueIndex('orders_order_number_uq').on(t.orderNumber),
    phoneIdx: index('orders_phone_idx').on(t.phoneNumber),
    statusIdx: index('orders_status_idx').on(t.status),
    createdIdx: index('orders_created_idx').on(t.createdAt),
    mewsOrderIdx: index('orders_mews_order_idx').on(t.mewsOrderId),
  })
);

// =====================================================================
// Users
// =====================================================================
export const users = pgTable(
  'users',
  {
    id: id(),
    name: text('name').notNull(),
    email: text('email'),
    phoneNumber: text('phone_number').notNull(),
    password: text('password'),
    addresses: jsonb('addresses')
      .$type<
        {
          street: string;
          houseNumber: string;
          postalCode: string;
          city: string;
          floor?: string;
          notes?: string;
          isDefault?: boolean;
        }[]
      >()
      .notNull()
      .default([]),
    role: text('role').notNull().default('customer'), // 'customer' | 'admin' | 'staff'
    passwordResetToken: text('password_reset_token'),
    passwordResetExpires: timestamp('password_reset_expires', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    // partial unique: несколько NULL email допускаются (sparse в Mongo)
    emailUq: uniqueIndex('users_email_uq').on(t.email).where(sql`${t.email} IS NOT NULL`),
    phoneUq: uniqueIndex('users_phone_uq').on(t.phoneNumber),
  })
);

// =====================================================================
// Coupons
// =====================================================================
export const coupons = pgTable(
  'coupons',
  {
    id: id(),
    code: text('code').notNull(),
    description: text('description'),
    discountType: text('discount_type').notNull(), // 'fixed' | 'percentage'
    discountValue: doublePrecision('discount_value').notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    validTo: timestamp('valid_to', { withTimezone: true, mode: 'date' }).notNull(),
    minOrderAmount: doublePrecision('min_order_amount'),
    usageLimit: integer('usage_limit'),
    usageCount: integer('usage_count').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    codeUq: uniqueIndex('coupons_code_uq').on(t.code),
  })
);

// =====================================================================
// Delivery zones
// =====================================================================
export const deliveryZones = pgTable(
  'delivery_zones',
  {
    id: id(),
    name: text('name').notNull(),
    minOrderAmount: doublePrecision('min_order_amount').notNull(),
    deliveryFee: doublePrecision('delivery_fee').notNull(),
    maxDistance: doublePrecision('max_distance').notNull(),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    sortIdx: index('delivery_zones_sort_idx').on(t.sortOrder, t.name),
  })
);

// =====================================================================
// Loyalty programs (transactions встроены в jsonb)
// =====================================================================
export const loyaltyPrograms = pgTable(
  'loyalty_programs',
  {
    id: id(),
    user: text('user').notNull(), // ref users.id
    phoneNumber: text('phone_number').notNull(),
    balance: doublePrecision('balance').notNull().default(0),
    totalEarned: doublePrecision('total_earned').notNull().default(0),
    totalRedeemed: doublePrecision('total_redeemed').notNull().default(0),
    transactions: jsonb('transactions')
      .$type<
        {
          user: string;
          order?: string;
          amount: number;
          type: 'earn' | 'redeem';
          description: string;
          createdAt: string;
        }[]
      >()
      .notNull()
      .default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    userUq: uniqueIndex('loyalty_user_uq').on(t.user),
    phoneUq: uniqueIndex('loyalty_phone_uq').on(t.phoneNumber),
  })
);

// =====================================================================
// Options (библиотека опций)
// =====================================================================
export const options = pgTable('options', {
  id: id(),
  name: text('name').notNull(),
  price: doublePrecision('price').notNull().default(0),
  active: boolean('active').notNull().default(true),
  order: integer('order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// =====================================================================
// Option groups
// =====================================================================
export const optionGroups = pgTable('option_groups', {
  id: id(),
  name: text('name').notNull(),
  optionIds: jsonb('option_ids').$type<string[]>().notNull().default([]),
  required: boolean('required').notNull().default(false),
  minSelect: integer('min_select').notNull().default(0),
  maxSelect: integer('max_select').notNull().default(0),
  active: boolean('active').notNull().default(true),
  order: integer('order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// =====================================================================
// Promotions
// =====================================================================
export const promotions = pgTable(
  'promotions',
  {
    id: id(),
    name: text('name').notNull(),
    internalName: text('internal_name'),
    description: text('description'),
    slug: text('slug').notNull(),
    type: text('type').notNull(), // PromotionType
    enabled: boolean('enabled').notNull().default(true),
    validFrom: timestamp('valid_from', { withTimezone: true, mode: 'date' }).notNull(),
    validTo: timestamp('valid_to', { withTimezone: true, mode: 'date' }).notNull(),
    scope: text('scope'), // 'order' | 'products'
    percentValue: doublePrecision('percent_value'),
    fixedValue: doublePrecision('fixed_value'),
    minOrderAmount: doublePrecision('min_order_amount'),
    gratisTrigger: text('gratis_trigger'),
    giftProductId: text('gift_product_id'),
    giftProductName: text('gift_product_name'),
    giftProductIds: jsonb('gift_product_ids').$type<string[]>().notNull().default([]),
    bogoMode: text('bogo_mode'),
    targetProductIds: jsonb('target_product_ids').$type<string[]>().notNull().default([]),
    targetCategoryIds: jsonb('target_category_ids').$type<string[]>().notNull().default([]),
    targetItems: jsonb('target_items')
      .$type<{ productId: string; sizeName?: string }[]>()
      .notNull()
      .default([]),
    rewardItems: jsonb('reward_items')
      .$type<{ productId: string; sizeName?: string }[]>()
      .notNull()
      .default([]),
    audience: text('audience').notNull().default('all'),
    channel: text('channel').notNull().default('all'),
    image: text('image'),
    bannerImage: text('banner_image'),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    ogImage: text('og_image'),
    badgeText: text('badge_text'),
    promoCode: text('promo_code'),
    showInModal: boolean('show_in_modal').notNull().default(true),
    showOnOffersPage: boolean('show_on_offers_page').notNull().default(true),
    priority: integer('priority').notNull().default(0),
    usageCount: integer('usage_count').notNull().default(0),
    viewCount: integer('view_count').notNull().default(0),
    modalOpenCount: integer('modal_open_count').notNull().default(0),
    clickCount: integer('click_count').notNull().default(0),
    orderCount: integer('order_count').notNull().default(0),
    revenueTotal: doublePrecision('revenue_total').notNull().default(0),
    weekdayScheduleEnabled: boolean('weekday_schedule_enabled').notNull().default(true),
    happyHourEnabled: boolean('happy_hour_enabled').notNull().default(false),
    activeDaysOfWeek: jsonb('active_days_of_week')
      .$type<number[]>()
      .notNull()
      .default([0, 1, 2, 3, 4, 5, 6]),
    activeTimeStart: text('active_time_start').default('16:00'),
    activeTimeEnd: text('active_time_end').default('18:00'),
    scheduleTimeZone: text('schedule_time_zone').default('Europe/Berlin'),
    autoNotifyOnStart: boolean('auto_notify_on_start').notNull().default(false),
    lastAutoNotifyAt: timestamp('last_auto_notify_at', { withTimezone: true, mode: 'date' }),
    emailCampaignEnabled: boolean('email_campaign_enabled').notNull().default(false),
    emailSubject: text('email_subject'),
    emailBodyHtml: text('email_body_html'),
    emailSentAt: timestamp('email_sent_at', { withTimezone: true, mode: 'date' }),
    emailSentCount: integer('email_sent_count').notNull().default(0),
    pushCampaignEnabled: boolean('push_campaign_enabled').notNull().default(false),
    pushTitle: text('push_title'),
    pushBody: text('push_body'),
    pushSentAt: timestamp('push_sent_at', { withTimezone: true, mode: 'date' }),
    pushSentCount: integer('push_sent_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    slugUq: uniqueIndex('promotions_slug_uq').on(t.slug),
    promoCodeUq: uniqueIndex('promotions_promo_code_uq')
      .on(t.promoCode)
      .where(sql`${t.promoCode} IS NOT NULL`),
    activeIdx: index('promotions_active_idx').on(t.type, t.enabled, t.validFrom, t.validTo),
  })
);

// =====================================================================
// Promotion campaign logs (только createdAt)
// =====================================================================
export const promotionCampaignLogs = pgTable(
  'promotion_campaign_logs',
  {
    id: id(),
    promotionId: text('promotion_id').notNull(),
    channel: text('channel').notNull(), // 'email' | 'push'
    triggeredBy: text('triggered_by').notNull().default('manual'),
    recipientCount: integer('recipient_count').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    failureCount: integer('failure_count').notNull().default(0),
    subject: text('subject'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => ({
    promotionIdx: index('promo_log_promotion_idx').on(t.promotionId),
  })
);

// =====================================================================
// Push devices
// =====================================================================
export const pushDevices = pgTable(
  'push_devices',
  {
    id: id(),
    token: text('token').notNull(),
    platform: text('platform').notNull().default('android'),
    phoneNumber: text('phone_number'),
    email: text('email'),
    active: boolean('active').notNull().default(true),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    tokenUq: uniqueIndex('push_devices_token_uq').on(t.token),
    activePlatformIdx: index('push_devices_active_platform_idx').on(t.active, t.platform),
  })
);

// =====================================================================
// Settings (key/value, value — произвольный JSON)
// =====================================================================
export const settings = pgTable(
  'settings',
  {
    id: id(),
    key: text('key').notNull(),
    value: jsonb('value').$type<unknown>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    keyUq: uniqueIndex('settings_key_uq').on(t.key),
  })
);

// =====================================================================
// Size variations (библиотека размеров)
// =====================================================================
export const sizeVariations = pgTable('size_variations', {
  id: id(),
  name: text('name').notNull(),
  label: text('label').notNull().default(''),
  order: integer('order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// =====================================================================
// WhatsApp queue
// =====================================================================
export const whatsappQueue = pgTable(
  'whatsapp_queue',
  {
    id: id(),
    phone: text('phone').notNull(),
    text: text('text').notNull(),
    status: text('status').notNull().default('pending'), // 'pending' | 'sent' | 'failed'
    error: text('error'),
    orderId: text('order_id'),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    statusIdx: index('whatsapp_queue_status_idx').on(t.status, t.createdAt),
  })
);

// =====================================================================
// Pre-orders (схема определена инлайн в app/api/pre-orders/route.ts)
// =====================================================================
export const preOrders = pgTable('pre_orders', {
  id: id(),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  address: text('address').notNull(),
  email: text('email'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---- выводимые типы (select/insert) ----
export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type User = typeof users.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type DeliveryZone = typeof deliveryZones.$inferSelect;
export type LoyaltyProgram = typeof loyaltyPrograms.$inferSelect;
export type Option = typeof options.$inferSelect;
export type OptionGroup = typeof optionGroups.$inferSelect;
export type Promotion = typeof promotions.$inferSelect;
export type PromotionCampaignLog = typeof promotionCampaignLogs.$inferSelect;
export type PushDevice = typeof pushDevices.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type SizeVariation = typeof sizeVariations.$inferSelect;
export type WhatsAppQueueRow = typeof whatsappQueue.$inferSelect;
export type PreOrder = typeof preOrders.$inferSelect;
