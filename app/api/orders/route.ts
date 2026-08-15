import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../lib/models';
import { Order } from '../../../lib/models/order.model';
import { Product } from '../../../lib/models/product.model';
import { Category } from '../../../lib/models/category.model';
import { readSubcategories } from '../../../lib/categories/subcategories';
import { Coupon } from '../../../lib/models/coupon.model';
import { DeliveryZone } from '../../../lib/models/delivery-zone.model';
import {
  resolveDeliveryFee,
  normalizeFreeDeliveryThreshold,
} from '../../../lib/delivery/delivery-fee';
import { isCouponCurrentlyValid, normalizeCouponCode } from '../../../lib/promotions/coupon-validity';
import { calculateOrderPromotions } from '../../../lib/promotions/order-integration';
import {
  resolveFreeGiftsForOrder,
  enrichFreeGiftOffers,
  applySelectedFreeGifts,
} from '../../../lib/promotions/gifts';
import { validateBogoSecondSelection } from '../../../lib/promotions/bogo';
import { getAppliedPromotionDiscount, getVisibleBogoSecondItems } from '../../../lib/promotions/discount-total';
import { finalizeOrderPlacement } from '../../../lib/orders/finalize';
import {
  initialOrderPlacementState,
  visibleOrderStatusFilter,
  sweepStaleDraftsThrottled,
} from '../../../lib/orders/payment-draft';
import { claimPendingPrintOrders } from '../../../lib/orders/print-queue';
import { getSetting } from '../../../lib/settings';
import {
  formatMinutesAsHHmm,
  getNowMinutesInTimeZone,
  parseOrdersTimeToMinutes,
} from '../../../lib/order-acceptance-hours';
import {
  WORKSHOP_BLOCK_MESSAGE_KEY,
  blockedWorkshopsForItems,
  buildWorkshopBlockMessage,
  formatBlockTemplate,
  readWorkshopBlocks,
  withGlobalBlock,
} from '../../../lib/kitchen/workshops';
import { getServerSession } from 'next-auth';
import { authOptions, isStaff } from '../../../lib/auth';
import { getCustomerSession } from '../../../lib/customer-auth';
import { signOrderAccessToken } from '../../../lib/orders/access-token';
import { rateLimit, getClientIp, logSecurityEvent } from '../../../lib/security/rate-limit';
import { getBalance } from '../../../lib/loyalty/service';
import { getLoyaltyRules, computeMaxRedeemablePoints } from '../../../lib/loyalty/config';
import { hydrateSizeVariationStates } from '../../../lib/size-variation-sync';
import { hasConfiguredRegularSizes } from '../../../lib/product-pricing';

/**
 * Тариф доставки заказа. Источник правды — зона в БД (клиент прислал её id),
 * клиентская сумма — только запасной вариант для мобильного приложения и
 * повторов заказа, где id зоны нет.
 */
async function resolveZoneDeliveryFee(
  zoneId: unknown,
  clientFee: unknown
): Promise<number> {
  const fallback = Number(clientFee) || 0;
  if (typeof zoneId !== 'string' || !zoneId.trim()) return fallback;
  try {
    const zone = await DeliveryZone.findById(zoneId);
    if (zone && zone.active) return Number(zone.deliveryFee) || 0;
  } catch (error) {
    console.error('Delivery zone lookup failed:', error);
  }
  return fallback;
}

function normalizeSizeKey(value: unknown): string {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('de-DE')
    .replace(/[×x]/g, 'x')
    .replace(/\s+/g, '');
}

function toPublicOrderView(order: any) {
  const source = typeof order.toObject === 'function' ? order.toObject() : order;
  return {
    // Внутренний _id намеренно НЕ отдаём анонимному вызову: иначе перебор
    // последовательных orderNumber выдаёт id заказа, а по id (+известный телефон
    // жертвы) раньше вытаскивался адрес. Публичная выборка — только не-PII статус.
    orderNumber: source.orderNumber,
    items: source.items,
    deliveryType: source.deliveryType,
    deliveryFee: source.deliveryFee,
    subtotal: source.subtotal,
    total: source.total,
    status: source.status,
    paymentStatus: source.paymentStatus,
    loyaltyPointsUsed: source.loyaltyPointsUsed,
    promotionDiscount: source.promotionDiscount,
    appliedPromotions: source.appliedPromotions,
    freeGifts: source.freeGifts,
    desiredDeliveryTime: source.desiredDeliveryTime,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();

    // Parse the request body
    const orderData = await request.json();

    // Check if orders are currently blocked
    const storeSettings = await getSetting<Record<string, any>>('storeSettings', {});
    const startMinutes = parseOrdersTimeToMinutes(storeSettings?.ordersStartHour, 16);
    const endMinutes = parseOrdersTimeToMinutes(storeSettings?.ordersEndHour, 22);
    const timeZone = storeSettings?.ordersTimeZone || 'Europe/Berlin';
    const blockedUntil = storeSettings?.ordersBlockedUntil
      ? new Date(storeSettings.ordersBlockedUntil)
      : null;
    const blockReason = storeSettings?.ordersBlockedReason || 'Кухня переполнена. Попробуйте позже.';
    const beforeOpenTemplate = storeSettings?.ordersClosedMessageBeforeOpen || 'Мы откроем в {time}';
    const afterCloseMessage = storeSettings?.ordersClosedMessageAfterClose || 'Мы закрыты, вернемся к вам завтра.';

    const now = new Date();
    const nowMinutes = getNowMinutesInTimeZone(timeZone, now);

    // Пауза приёма (глобальная и по цехам) проверяется НИЖЕ — после того, как
    // подтянуты категории позиций: только там видно, задет ли заказ стопом цеха
    // и какой из двух сроков позже.

    if (nowMinutes < startMinutes) {
      const timeLabel = formatMinutesAsHHmm(startMinutes);
      const closedReason = beforeOpenTemplate.replace('{time}', timeLabel);
      return NextResponse.json(
        { success: false, error: closedReason, opensAtTime: timeLabel },
        { status: 403 }
      );
    }

    if (nowMinutes >= endMinutes) {
      return NextResponse.json(
        { success: false, error: afterCloseMessage, opensAtTime: formatMinutesAsHHmm(startMinutes) },
        { status: 403 }
      );
    }

    // Ставка НДС берётся из карточки товара (taxRate, назначается в админке).
    // Подтягиваем её с сервера по productId — не доверяем клиенту.
    const lineProductIds = Array.from(
      new Set(
        (orderData.items || [])
          .map((i: any) => i.productId || i.id)
          .filter((id: any): id is string => typeof id === 'string' && id.length > 0)
      )
    );
    const taxRateByProduct = new Map<string, number>();
    const categoryByProduct = new Map<string, string>();
    const subcategoryByProduct = new Map<string, string>();
    // Имена категорий и подкатегорий (для группировки в кухонном чеке) + НДС.
    // Подкатегория — метка из categories.subcategories; в позицию заказа
    // пишем её ИМЯ на момент заказа (снимок, как и category).
    const collectProductMeta = async (products: any[]) => {
      const catIds = Array.from(
        new Set(products.map((p) => String(p.category)).filter(Boolean))
      );
      const catNameById = new Map<string, string>();
      const subNameByCatId = new Map<string, Map<string, string>>();
      if (catIds.length > 0) {
        const cats = await Category.find({ _id: { $in: catIds } })
          .select('name subcategories')
          .lean();
        for (const c of cats) {
          catNameById.set(String((c as any)._id), (c as any).name);
          subNameByCatId.set(
            String((c as any)._id),
            new Map(readSubcategories(c as any).map((s) => [s.id, s.name]))
          );
        }
      }
      for (const p of products) {
        const id = String(p._id);
        if (typeof p.taxRate === 'number' && p.taxRate > 0) {
          taxRateByProduct.set(id, p.taxRate);
        }
        const catName = catNameById.get(String(p.category));
        if (catName) categoryByProduct.set(id, catName);
        const subName = subNameByCatId
          .get(String(p.category))
          ?.get(String(p.subcategoryId || ''));
        if (subName) subcategoryByProduct.set(id, subName);
      }
    };
    if (lineProductIds.length > 0) {
      const lineProducts = await Product.find({ _id: { $in: lineProductIds } })
        .select('taxRate category sizes subcategoryId')
        .lean();
      await hydrateSizeVariationStates(lineProducts as any[]);

      const productById = new Map(lineProducts.map((p: any) => [String(p._id), p]));
      for (const item of orderData.items || []) {
        const product = productById.get(String(item.productId || item.id));
        const sizes = Array.isArray((product as any)?.sizes) ? (product as any).sizes : [];
        if (!item?.size) {
          if (product && hasConfiguredRegularSizes(product as any)) {
            return NextResponse.json(
              {
                success: false,
                error: `Bitte wählen Sie für „${item.name || 'den Artikel'}“ erneut eine verfügbare Größe.`,
              },
              { status: 400 }
            );
          }
          continue;
        }
        if (sizes.length === 0) continue;

        const requestedVariationId = String(item.size.variationId || '');
        const requestedKeys = new Set(
          [item.size.id, item.size.name, item.size.label, item.size.size]
            .map(normalizeSizeKey)
            .filter(Boolean)
        );
        const matchedSize = sizes.find((size: any) => {
          if (
            requestedVariationId &&
            String(size?.variationId || '') === requestedVariationId
          ) {
            return true;
          }
          return [size?.id, size?.name, size?.label, size?.size]
            .map(normalizeSizeKey)
            .some((key) => key && requestedKeys.has(key));
        });

        if (!matchedSize || matchedSize.active === false) {
          return NextResponse.json(
            {
              success: false,
              error: `Die Größe „${item.size.name || item.size.label || ''}“ ist nicht mehr verfügbar. Bitte aktualisieren Sie den Warenkorb.`,
            },
            { status: 400 }
          );
        }
      }

      await collectProductMeta(lineProducts as any[]);
    }

    // Стоп по цехам (стоп-бот / админка): заказ отклоняем, только если в нём
    // есть позиции остановленного цеха. Категорию берём с сервера, а не из
    // корзины — классификация не должна зависеть от того, что прислал клиент.
    const workshopBlocks = readWorkshopBlocks(storeSettings);
    const blockedWorkshops = blockedWorkshopsForItems(
      (orderData.items || []).map((item: any) => {
        const productId = item.productId || item.id;
        return {
          category: categoryByProduct.get(productId),
          subcategory: subcategoryByProduct.get(productId),
          name: item.name,
        };
      }),
      workshopBlocks,
      now
    );
    if (blockedWorkshops.length > 0) {
      return NextResponse.json(
        {
          success: false,
          // Сообщение цеха точнее глобального, а срок — поздний из двух:
          // «весь приём 10 мин + суши 30 мин» = 30, иначе гость вернётся зря.
          error: buildWorkshopBlockMessage(blockedWorkshops, {
            blocks: withGlobalBlock(workshopBlocks, storeSettings?.ordersBlockedUntil),
            now,
            template: storeSettings?.[WORKSHOP_BLOCK_MESSAGE_KEY],
          }),
          blockedWorkshops,
        },
        { status: 403 }
      );
    }

    // Глобальный стоп приёма — заказ без позиций остановленных цехов.
    if (blockedUntil && blockedUntil.getTime() > now.getTime()) {
      return NextResponse.json(
        {
          success: false,
          // В тексте из админки работают {minutes}/@ и {time}.
          error: formatBlockTemplate(blockReason, blockedUntil.toISOString(), now),
          blockedUntil: blockedUntil.toISOString(),
        },
        { status: 403 }
      );
    }

    // Transform items to match Order schema
    const transformedItems = orderData.items.map((item: any) => ({
      product: item.productId || item.id, // Product ID from cart
      name: item.name,
      quantity: item.quantity,
      price: item.price, // Price per unit
      category: categoryByProduct.get(item.productId || item.id),
      subcategory: subcategoryByProduct.get(item.productId || item.id),
      taxRate: taxRateByProduct.get(item.productId || item.id),
      size: item.size ? {
        id: item.size.id || '',
        name: item.size.name || '',
        size: item.size.label || item.size.size || '',
        price: item.size.price != null ? item.size.price : (item.size.priceModifier || 0)
      } : undefined,
      extras: item.extras ? {
        toppings: item.extras.toppings?.map((t: any) => ({
          id: t.id || '',
          name: t.name || '',
          price: t.price || 0
        })) || [],
        sauces: item.extras.sauces?.map((s: any) => ({
          id: s.id || '',
          name: s.name || '',
          price: s.price || 0
        })) || [],
        sides: item.extras.sides?.map((s: any) => ({
          id: s.id || '',
          name: s.name || '',
          price: s.price || 0
        })) || []
      } : undefined,
      options: Array.isArray(item.options)
        ? item.options.map((o: any) => ({
            groupId: o.groupId || '',
            group: o.group || '',
            name: o.name || '',
            price: o.price || 0
          }))
        : undefined,
      totalPrice: item.price * item.quantity // Total price for this item
    }));

    // Calculate subtotal from items
    const calculatedSubtotal = transformedItems.reduce(
      (sum, item) => sum + item.totalPrice,
      0
    );

    // Доставка: тариф берём из зоны в БД (клиенту тут не верим), порог
    // бесплатной доставки — настройка магазина, по умолчанию выключен.
    const zoneDeliveryFee = await resolveZoneDeliveryFee(
      orderData.deliveryZoneId,
      orderData.deliveryFee
    );
    const freeDeliveryThreshold = normalizeFreeDeliveryThreshold(
      storeSettings?.freeDeliveryThreshold
    );

    // Списание баллов считаем НИЖЕ (после купона/акций) на сервере —
    // не доверяя клиенту: cap 30% и минимальная сумма проверяются здесь.
    let couponDiscount = 0;
    let validatedCoupon: any = null;
    const couponCode = normalizeCouponCode(orderData.couponCode);
    if (couponCode) {
      // Тот же helper, что и в /api/coupons — checkout не может отклонить купон,
      // который UI принял (единая семантика дат/лимитов/min-order).
      validatedCoupon = await Coupon.findOne({ code: couponCode });

      const validity = isCouponCurrentlyValid(validatedCoupon as any, new Date(), calculatedSubtotal);
      if (!validity.valid) {
        return NextResponse.json(
          { success: false, error: 'Invalid or expired coupon', reason: validity.reason },
          { status: 400 }
        );
      }

      couponDiscount = validatedCoupon.discountType === 'fixed'
        ? Math.min(validatedCoupon.discountValue, calculatedSubtotal)
        : Math.min(calculatedSubtotal * (validatedCoupon.discountValue / 100), calculatedSubtotal);
    }

    // --- Акции (Angebote): автоматические скидки, BOGO и гратис-артикулы ---
    const promotionPromoCode =
      typeof orderData.promotionPromoCode === 'string'
        ? orderData.promotionPromoCode.trim().toUpperCase()
        : typeof orderData.promoCode === 'string'
          ? orderData.promoCode.trim().toUpperCase()
          : '';

    const selectedBogoSecond = Array.isArray(orderData.selectedBogoSecond)
      ? orderData.selectedBogoSecond.filter(
          (s: unknown) =>
            s &&
            typeof s === 'object' &&
            typeof (s as { promotionId?: unknown }).promotionId === 'string' &&
            typeof (s as { productId?: unknown }).productId === 'string'
        )
      : [];

    const selectedFreeGifts = Array.isArray(orderData.selectedFreeGifts)
      ? orderData.selectedFreeGifts.filter(
          (s: unknown) =>
            s &&
            typeof s === 'object' &&
            typeof (s as { promotionId?: unknown }).promotionId === 'string' &&
            typeof (s as { productId?: unknown }).productId === 'string'
        )
      : [];

    const promotionItems = Array.isArray(orderData.items) ? orderData.items : [];

    // --- Решение о списании баллов (нужно ДО расчёта акций) ---
    // Иерархия скидок, ровно одна на заказ: Code > Treuepunkte > Angebot.
    // Баллы вытесняют денежные акции, поэтому «будут ли баллы» надо знать заранее.
    // База считается по сценарию БЕЗ акций (они подавлены) — та же формула, что
    // в клиентском loyaltyRedeemBaseAmount, поэтому клиент и сервер не расходятся.
    const customerSession = getCustomerSession(request);
    const requestedPoints = Number(orderData.loyaltyPointsToRedeem) || 0;
    const discountCodeActive = couponDiscount > 0 || !!promotionPromoCode;
    let loyaltyRules: Awaited<ReturnType<typeof getLoyaltyRules>> | null = null;
    let loyaltyBalance = 0;
    let pointsIntended = false;
    if (customerSession && requestedPoints > 0 && !discountCodeActive) {
      loyaltyRules = await getLoyaltyRules();
      loyaltyBalance = await getBalance(customerSession.userId);
      const feeWithoutPromotions = resolveDeliveryFee({
        deliveryType: orderData.deliveryType === 'pickup' ? 'pickup' : 'delivery',
        merchandiseSubtotal: calculatedSubtotal,
        zoneDeliveryFee: zoneDeliveryFee,
        freeDeliveryThreshold,
      });
      const baseAmount = Math.max(calculatedSubtotal + feeWithoutPromotions - couponDiscount, 0);
      pointsIntended =
        computeMaxRedeemablePoints(loyaltyBalance, baseAmount, loyaltyRules) > 0;
    }

    let promotionCalc = await calculateOrderPromotions(promotionItems, {
      channel: orderData.channel === 'app' ? 'app' : 'web',
      promoCode: promotionPromoCode || undefined,
      phoneNumber: orderData.phoneNumber,
      selectedBogoSecond,
      // AC #7: при активном купоне ИЛИ списании баллов денежные акции не
      // комбинируем (никогда две денежные скидки).
      excludeMoneyDiscounts: couponDiscount > 0 || pointsIntended,
    });

    const giftProductIds = new Set<string>();
    for (const offer of promotionCalc.freeGiftOffers || []) {
      for (const opt of offer.options) {
        giftProductIds.add(opt.productId);
      }
    }
    if (giftProductIds.size > 0) {
      const products = await Product.find({ _id: { $in: Array.from(giftProductIds) } })
        .select('name image')
        .lean();
      const productsById = new Map(
        products.map((p) => [
          String(p._id),
          { name: p.name as string, image: p.image as string | undefined },
        ])
      );
      promotionCalc = enrichFreeGiftOffers(promotionCalc, productsById);
      if (selectedFreeGifts.length > 0) {
        promotionCalc = applySelectedFreeGifts(promotionCalc, selectedFreeGifts);
      }
    } else if (selectedFreeGifts.length > 0) {
      promotionCalc = applySelectedFreeGifts(promotionCalc, selectedFreeGifts);
    }

    // Награды BOGO и Gratis-Artikel опциональны (вариант «только попап»):
    // наличие непринятого оффера НЕ блокирует заказ — клиент мог отказаться
    // («Nein, danke»).

    const bogoError = validateBogoSecondSelection(promotionCalc, selectedBogoSecond);
    if (bogoError.error) {
      return NextResponse.json({ success: false, error: bogoError.error }, { status: 400 });
    }

    const promotionDiscount = getAppliedPromotionDiscount(promotionCalc);
    const bogoSecondItems = getVisibleBogoSecondItems(promotionCalc);
    const bogoMerchandise = bogoSecondItems.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0
    );
    const merchandiseSubtotal = calculatedSubtotal + bogoMerchandise;
    const effectiveDeliveryFee = resolveDeliveryFee({
      deliveryType: orderData.deliveryType === 'pickup' ? 'pickup' : 'delivery',
      merchandiseSubtotal,
      zoneDeliveryFee,
      freeDeliveryThreshold,
    });

    const { freeGifts: resolvedFreeGifts, error: giftError } = resolveFreeGiftsForOrder(
      promotionCalc,
      selectedFreeGifts
    );
    if (giftError) {
      return NextResponse.json({ success: false, error: giftError }, { status: 400 });
    }
    const resolvedGiftPromotionIds = new Set(resolvedFreeGifts.map((g) => g.promotionId));
    const appliedPromotions = promotionCalc.appliedPromotions.filter(
      (p) => p.promotionType !== 'gratis_article' || resolvedGiftPromotionIds.has(p.promotionId)
    );

    // Награды акций (вторая позиция BOGO, Gratis-Artikel) могут не входить в
    // строки корзины — доснимаем их карточки, чтобы и у наград были категория/
    // подкатегория (группировка кухонного чека) и НДС.
    const promoProductIds = Array.from(
      new Set(
        [
          ...bogoSecondItems.map((i) => String(i.productId || '')),
          ...resolvedFreeGifts.map((g) => String(g.productId || '')),
        ].filter((id) => id && !categoryByProduct.has(id))
      )
    );
    if (promoProductIds.length > 0) {
      const promoProducts = await Product.find({ _id: { $in: promoProductIds } })
        .select('taxRate category subcategoryId')
        .lean();
      await collectProductMeta(promoProducts as any[]);
    }

    const bogoOrderItems = bogoSecondItems.map((item) => ({
      product: item.productId,
      name: item.bogoMode === 'free' ? `[GRATIS] ${item.name}` : `[AKTION] ${item.name}`,
      quantity: item.quantity,
      price: item.unitPrice,
      totalPrice: item.unitPrice * item.quantity,
      category: categoryByProduct.get(String(item.productId || '')),
      subcategory: subcategoryByProduct.get(String(item.productId || '')),
      taxRate: taxRateByProduct.get(String(item.productId || '')),
    }));

    const giftOrderItems = resolvedFreeGifts.map((g) => ({
      product: g.productId,
      name: `[GRATIS] ${g.name}`,
      quantity: g.quantity,
      price: 0,
      totalPrice: 0,
      category: categoryByProduct.get(String(g.productId || '')),
      subcategory: subcategoryByProduct.get(String(g.productId || '')),
      taxRate: taxRateByProduct.get(String(g.productId || '')),
    }));

    const orderItems = [...transformedItems, ...bogoOrderItems, ...giftOrderItems];

    // --- Списание баллов лояльности (сервер — источник истины) ---
    // Разрешено только авторизованному клиенту; cap (30%) и минимальная сумма
    // проверяются по серверным правилам. user_id берётся из cookie-сессии.
    const amountBeforePoints = Math.max(
      merchandiseSubtotal + effectiveDeliveryFee - couponDiscount - promotionDiscount,
      0
    );
    let loyaltyPointsUsed = 0;
    let loyaltyPointsDiscount = 0;
    // Решение (pointsIntended) принято выше — при активном коде баллы не
    // списываются вовсе (код выигрывает, баланс клиента не трогаем), а при
    // списании баллов денежные акции уже подавлены, т.е. amountBeforePoints
    // равен базе из pointsIntended-проверки → maxRedeemable > 0.
    if (pointsIntended && loyaltyRules) {
      const maxRedeemable = computeMaxRedeemablePoints(
        loyaltyBalance,
        amountBeforePoints,
        loyaltyRules
      );
      loyaltyPointsUsed = Math.min(requestedPoints, maxRedeemable);
      loyaltyPointsDiscount = loyaltyPointsUsed * loyaltyRules.pointValueEuro;
    }

    const calculatedTotal = Math.max(amountBeforePoints - loyaltyPointsDiscount, 0);

    // SMS-Marketing-Einwilligung: текст согласия фиксируем на сервере (не доверяем
    // клиенту), чтобы хранить именно то, под чем подписался клиент.
    const smsConsentGiven = orderData.smsMarketingConsent === true;
    const SMS_CONSENT_TEXT =
      'Ja, ich möchte Angebote und Aktionen von Dumbos Pizza per SMS erhalten. Abmeldung jederzeit möglich.';

    const orderPayload = {
      customerName: orderData.customerName,
      phoneNumber: orderData.phoneNumber,
      email: orderData.email,
      smsMarketingConsent: smsConsentGiven,
      smsConsentAt: smsConsentGiven ? new Date() : undefined,
      smsConsentText: smsConsentGiven ? SMS_CONSENT_TEXT : undefined,
      // Привязка к аккаунту, если клиент авторизован (для кабинета/лояльности).
      user: customerSession?.userId,
      items: orderItems,
      deliveryType: orderData.deliveryType,
      deliveryAddress: orderData.deliveryAddress,
      deliveryZone: orderData.deliveryZone,
      deliveryFee: effectiveDeliveryFee,
      subtotal: merchandiseSubtotal,
      tax: typeof orderData.tax === 'number' ? orderData.tax : 0,
      total: calculatedTotal,
      paymentMethod: orderData.paymentMethod,
      paymentStatus: 'pending',
      // Онлайн-оплата: заказ рождается ДРАФТОМ (pending_payment, без номера) и
      // становится «Новым» только после серверного подтверждения оплаты
      // (SumUp webhook/confirm, PayPal capture/webhook → claimOrderPaidAndPromote).
      // Отмена/закрытие окна/FAILED/EXPIRED «Новый» заказ не создают.
      status: initialOrderPlacementState(orderData.paymentMethod).status,
      kitchenPrintStatus: 'pending',
      customerPrintStatus: 'pending',
      loyaltyPointsUsed,
      discount: couponDiscount > 0
        ? {
            code: couponCode,
            amount: couponDiscount,
            type: validatedCoupon?.discountType || 'fixed'
          }
        : undefined,
      promotionDiscount,
      promotionPromoCode: promotionPromoCode || undefined,
      appliedPromotions: appliedPromotions.map((p) => ({
        promotionId: p.promotionId,
        name: p.promotionName,
        type: p.promotionType,
        savedAmount: p.savedAmount,
      })),
      freeGifts: resolvedFreeGifts.map((g) => ({
        productId: g.productId,
        name: g.name,
        quantity: g.quantity,
        promotionId: g.promotionId,
        label: g.label,
      })),
      notes: orderData.notes,
      desiredDeliveryTime: orderData.desiredDeliveryTime || undefined
    };

    // Create a new order (orderNumber will be generated in pre-save hook)
    const order = new Order(orderPayload);
    await order.save();

    // Побочные эффекты заказа: списание купона, баллы лояльности, аналитика
    // акций, уведомления (Telegram/WhatsApp/конверсии) и печать чеков.
    // Для онлайн-оплаты заказ — драфт: финализация происходит ТОЛЬКО при
    // промоуте после подтверждения оплаты (SumUp webhook/confirm, PayPal
    // capture/webhook). Кухня/Telegram/печать по неоплаченному заказу не срабатывают.
    if (initialOrderPlacementState(order.paymentMethod).finalizeImmediately) {
      await finalizeOrderPlacement(order, request);
    } else {
      console.log(
        `[payment-draft] created order=${order._id} total=${order.total} — awaiting online payment`
      );
    }

    return NextResponse.json({
      success: true,
      order: {
        id: order._id.toString(),
        orderNumber: order.orderNumber,
        status: order.status,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        total: order.total,
        loyaltyPointsEarned: order.loyaltyPointsEarned || 0,
        // Подписанный токен доступа: единственный ключ, по которому гость без
        // сессии сможет открыть свой заказ/счёт (страница подтверждения).
        accessToken: signOrderAccessToken(order._id.toString())
      }
    }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating order:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const phoneNumber = searchParams.get('phoneNumber');
    const orderNumber = searchParams.get('orderNumber');
    const status = searchParams.get('status');
    const kitchenPrintStatus = searchParams.get('kitchenPrintStatus');
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const skip = (page - 1) * limit;

    let canReadFullOrders = false;
    let isPrintAgent = false;
    if (!phoneNumber && !orderNumber) {
      // Принт-агент забирает очередь печати без staff-сессии: авторизуем его тем же
      // секретом, что и /mark-printed (X-Print-Agent-Key), и только для запросов
      // очереди печати (kitchenPrintStatus задан).
      const printAgentKey = request.headers.get('X-Print-Agent-Key');
      isPrintAgent =
        !!process.env.PRINT_AGENT_SECRET &&
        printAgentKey === process.env.PRINT_AGENT_SECRET &&
        !!kitchenPrintStatus;

      if (!isPrintAgent) {
        const session = await getServerSession(authOptions);
        if (!session || !isStaff(session)) {
          return NextResponse.json(
            { success: false, error: 'Unauthorized' },
            { status: 401 }
          );
        }
        canReadFullOrders = true;
      } else {
        canReadFullOrders = true;
      }
    }

    // Гостевой поиск (/track по телефону или номеру заказа) — не-PII публичная
    // выборка, но перебираемая. Лимитируем по IP, чтобы не парсили базу.
    if (!canReadFullOrders) {
      const ip = getClientIp(request);
      const rl = rateLimit(`orders-list:${ip}`, 20, 60_000);
      if (!rl.allowed) {
        logSecurityEvent('orders-list-rate-limited', {
          ip,
          phoneNumber: phoneNumber ? 'provided' : undefined,
          orderNumber: orderNumber || undefined,
        });
        return NextResponse.json(
          { success: false, error: 'Too many requests' },
          { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
        );
      }
    }

    // Ленивая TTL-очистка брошенных онлайн-драфтов (страховка, если cron
    // не настроен): не чаще раза в 10 минут на инстанс, ошибки глотает.
    if (canReadFullOrders) {
      await sweepStaleDraftsThrottled();
    }

    const query: any = {};
    if (phoneNumber) query.phoneNumber = phoneNumber;
    if (orderNumber) query.orderNumber = orderNumber;
    // Драфты онлайн-оплаты (pending_payment) НИКОГДА не попадают в выборку:
    // ни в админ-список «Заказы», ни в гостевой /track, ни принт-агенту.
    query.status = visibleOrderStatusFilter(status);
    if (kitchenPrintStatus) {
      query.kitchenPrintStatus = kitchenPrintStatus;
      // Принт-агент не должен видеть неоплаченные онлайн-заказы: SumUp-оплата
      // ещё не подтверждена (paymentStatus !== 'completed'). Оплата при получении
      // (cash/card) проходит гейт всегда.
      query.$or = [
        { paymentMethod: { $ne: 'online' } },
        { paymentStatus: 'completed' },
      ];
    }

    if (isPrintAgent && kitchenPrintStatus === 'pending') {
      // Атомарная выдача очереди печати (pending→printing + reclaim зависших):
      // kitchenPrintStatus добавляет print-queue, сюда идёт гейт по оплате
      // и статусу (драфты pending_payment агенту не выдаются никогда).
      const baseQuery: any = { $or: query.$or, status: query.status };
      const orders = await claimPendingPrintOrders(baseQuery, limit, {
        agentId: request.headers.get('X-Print-Agent-Id') || undefined,
      });

      return NextResponse.json({
        success: true,
        orders,
        pagination: {
          total: orders.length,
          page,
          limit,
          pages: orders.length > 0 ? 1 : 0
        }
      });
    }

    // Get orders with pagination
    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Get total count for pagination
    const total = await Order.countDocuments(query);

    return NextResponse.json({
      success: true,
      orders: canReadFullOrders ? orders : orders.map(toPublicOrderView),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    console.error('Error fetching orders:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
