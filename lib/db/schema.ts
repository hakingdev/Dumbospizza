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
  category?: string;
  taxRate?: number;
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
    // SMS-Marketing-Einwilligung (UWG §7 / DSGVO Art. 6 Abs. 1 lit. a) — отдельный
    // opt-in на checkout. Храним факт + дату + текст согласия (для доказательства).
    smsMarketingConsent: boolean('sms_marketing_consent').notNull().default(false),
    smsConsentAt: timestamp('sms_consent_at', { withTimezone: true, mode: 'date' }),
    smsConsentText: text('sms_consent_text'),
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
    // Баллы лояльности хранятся с центовой точностью (1 балл = 1 €, допускается
    // дробная часть — см. computeMaxRedeemablePoints/roundPoints). Поэтому
    // doublePrecision, а не integer: иначе insert падает на значениях вроде 1.68.
    loyaltyPointsUsed: doublePrecision('loyalty_points_used'),
    loyaltyPointsEarned: doublePrecision('loyalty_points_earned'),
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
    smsConsentIdx: index('orders_sms_consent_idx').on(t.smsMarketingConsent),
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
// Loyalty transactions (реальные строки — атомарность + полная история)
//
// loyaltyPrograms остаётся агрегатом баланса; здесь — журнал каждого
// начисления/списания/сгорания/корректировки. Списание идёт атомарным
// guarded-апдейтом баланса, журнал пишется строкой → нет двойного списания.
// =====================================================================
export const loyaltyTransactions = pgTable(
  'loyalty_transactions',
  {
    id: id(),
    user: text('user').notNull(), // ref users.id
    order: text('order'), // ref orders.id (для earn/redeem по заказу)
    // 'earn' | 'redeem' | 'expire' | 'adjust' | 'reverse'
    type: text('type').notNull(),
    // amount всегда положительный; знак определяется type (earn/adjust+/reverse-earn вычитают и т.п.)
    amount: doublePrecision('amount').notNull(),
    // Дельта баланса со знаком (+начисление / -списание) — упрощает аудит/реверс.
    delta: doublePrecision('delta').notNull(),
    balanceAfter: doublePrecision('balance_after').notNull().default(0),
    description: text('description').notNull().default(''),
    // Для earn: когда сгорают эти баллы (createdAt + expiryMonths).
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    // Сколько из этого earn-батча уже израсходовано (FIFO-списание/сгорание).
    consumed: doublePrecision('consumed').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => ({
    userIdx: index('loyalty_tx_user_idx').on(t.user, t.createdAt),
    orderTypeIdx: index('loyalty_tx_order_type_idx').on(t.order, t.type),
    expiryIdx: index('loyalty_tx_expiry_idx').on(t.type, t.expiresAt),
  })
);

// =====================================================================
// Customer notifications (по строке на получателя → статус прочтения на юзера)
//
// Рассылка всем/сегменту создаёт N строк (по одной на пользователя). Так
// read/readAt естественно живут на уровне пользователя без отдельной таблицы
// прочтений. campaignId группирует строки одной рассылки (для админ-аналитики).
// =====================================================================
export const customerNotifications = pgTable(
  'customer_notifications',
  {
    id: id(),
    user: text('user').notNull(), // ref users.id (получатель)
    title: text('title').notNull(),
    body: text('body').notNull(),
    // Необязательная ссылка на акцию/товар.
    link: text('link'),
    linkLabel: text('link_label'),
    // 'promo' | 'order' | 'loyalty' | 'system' — для иконки/фильтра.
    category: text('category').notNull().default('system'),
    read: boolean('read').notNull().default(false),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
    // Группировка строк одной рассылки + кто/как отправил.
    campaignId: text('campaign_id'),
    audience: text('audience'),
    createdAt: createdAt(),
  },
  (t) => ({
    userReadIdx: index('cust_notif_user_read_idx').on(t.user, t.read, t.createdAt),
    campaignIdx: index('cust_notif_campaign_idx').on(t.campaignId),
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
    // Точный выбор подарка (товар+размер), как rewardItems у BOGO. sizeName='' = все размеры.
    giftItems: jsonb('gift_items')
      .$type<{ productId: string; sizeName?: string }[]>()
      .notNull()
      .default([]),
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
    status: text('status').notNull().default('pending'), // 'pending' | 'sending' | 'sent' | 'failed' | 'skipped'
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

// =====================================================================
// Email-Abmeldungen (Widerspruch gegen Werbung, § 7 Abs. 3 Nr. 4 UWG).
// Suppression-Liste: эти адреса автоматически исключаются из рассылок.
// =====================================================================
export const emailUnsubscribes = pgTable(
  'email_unsubscribes',
  {
    id: id(),
    email: text('email').notNull(),
    source: text('source'), // 'campaign-link' | 'one-click' | 'manual'
    createdAt: createdAt(),
  },
  (t) => ({
    emailUq: uniqueIndex('email_unsubscribes_email_uq').on(t.email),
  })
);

// =====================================================================
// Payments — онлайн-платежи внешних провайдеров (пока пишет только PayPal;
// SumUp остаётся на своём флоу без записи в эту таблицу).
//
// Деньги здесь — В МИНОРНЫХ ЕДИНИЦАХ (integer-центы), в отличие от
// евро-double в остальной схеме: суммы сверяются с провайдером до цента,
// и float-арифметика тут недопустима. Конвертация на границе:
// Math.round(order.total * 100) (см. lib/paypal/amount.ts).
// =====================================================================
export const payments = pgTable(
  'payments',
  {
    id: id(),
    orderId: text('order_id').notNull(), // ref orders.id
    provider: text('provider').notNull(), // 'sumup' | 'paypal'
    /** ID заказа у провайдера (PayPal Order ID). */
    providerOrderId: text('provider_order_id').notNull(),
    /** ID capture у провайдера — появляется после успешного capture. */
    providerCaptureId: text('provider_capture_id'),
    // 'created' | 'approved' | 'captured' | 'failed' | 'refunded'
    //  | 'partially_refunded' | 'cancelled' | 'reversed'
    // Переходы — только вперёд (см. lib/paypal/status.ts).
    status: text('status').notNull().default('created'),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull().default('EUR'), // ISO-4217
    /** Последний сырой ответ провайдера (create/capture/refund/webhook). */
    rawPayload: jsonb('raw_payload').$type<unknown>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    // Идемпотентность create-order: один PayPal Order — одна строка.
    providerOrderUq: uniqueIndex('payments_provider_order_uq').on(t.provider, t.providerOrderId),
    orderIdx: index('payments_order_idx').on(t.orderId),
    captureIdx: index('payments_capture_idx').on(t.providerCaptureId),
  })
);

// =====================================================================
// Payment events — журнал вебхуков провайдеров. UNIQUE (provider, event_id)
// отбрасывает дубли/ретраи вебхука (INSERT ... ON CONFLICT DO NOTHING).
// =====================================================================
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: id(),
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<unknown>(),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    eventUq: uniqueIndex('payment_events_provider_event_uq').on(t.provider, t.eventId),
  })
);

// =====================================================================
// Refunds — возвраты по платежам. request_id (PayPal-Request-Id) генерируется
// и СОХРАНЯЕТСЯ ДО вызова провайдера: ретрай после сбоя переиспользует его и
// не создаёт второй возврат.
// =====================================================================
export const refunds = pgTable(
  'refunds',
  {
    id: id(),
    paymentId: text('payment_id').notNull(), // ref payments.id
    /** ID возврата у провайдера — появляется после ответа API. */
    providerRefundId: text('provider_refund_id'),
    /** Идемпотентный PayPal-Request-Id, зафиксированный до вызова. */
    requestId: text('request_id').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    // 'pending' | 'completed' | 'failed' | 'cancelled'
    status: text('status').notNull().default('pending'),
    reason: text('reason'),
    /** Кто инициировал (email админа или 'paypal' для внешних возвратов). */
    createdBy: text('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    // partial unique: NULL до ответа провайдера допускается многократно
    refundUq: uniqueIndex('refunds_provider_refund_uq')
      .on(t.providerRefundId)
      .where(sql`${t.providerRefundId} IS NOT NULL`),
    requestUq: uniqueIndex('refunds_request_uq').on(t.requestId),
    paymentIdx: index('refunds_payment_idx').on(t.paymentId),
  })
);

// ---- выводимые типы (select/insert) ----
export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type User = typeof users.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type DeliveryZone = typeof deliveryZones.$inferSelect;
export type LoyaltyProgram = typeof loyaltyPrograms.$inferSelect;
export type LoyaltyTransaction = typeof loyaltyTransactions.$inferSelect;
export type CustomerNotification = typeof customerNotifications.$inferSelect;
export type Option = typeof options.$inferSelect;
export type OptionGroup = typeof optionGroups.$inferSelect;
export type Promotion = typeof promotions.$inferSelect;
export type PromotionCampaignLog = typeof promotionCampaignLogs.$inferSelect;
export type PushDevice = typeof pushDevices.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type SizeVariation = typeof sizeVariations.$inferSelect;
export type WhatsAppQueueRow = typeof whatsappQueue.$inferSelect;
export type PreOrder = typeof preOrders.$inferSelect;
export type EmailUnsubscribe = typeof emailUnsubscribes.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type PaymentEvent = typeof paymentEvents.$inferSelect;
export type Refund = typeof refunds.$inferSelect;
