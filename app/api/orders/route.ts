import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../lib/models';
import { Order } from '../../../lib/models/order.model';
import { Product } from '../../../lib/models/product.model';
import { Category } from '../../../lib/models/category.model';
import { Coupon } from '../../../lib/models/coupon.model';
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
import { getSetting } from '../../../lib/settings';
import {
  formatMinutesAsHHmm,
  getNowMinutesInTimeZone,
  parseOrdersTimeToMinutes,
} from '../../../lib/order-acceptance-hours';
import { getServerSession } from 'next-auth';
import { authOptions, isStaff } from '../../../lib/auth';
import { getCustomerSession } from '../../../lib/customer-auth';
import { getBalance } from '../../../lib/loyalty/service';
import { getLoyaltyRules, computeMaxRedeemablePoints } from '../../../lib/loyalty/config';

function toPublicOrderView(order: any) {
  const source = typeof order.toObject === 'function' ? order.toObject() : order;
  return {
    _id: String(source._id),
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

async function claimPendingPrintOrders(query: any, limit: number) {
  const candidates = await Order.find(query)
    .sort({ createdAt: -1 })
    .limit(limit);

  const claimed: any[] = [];
  for (const candidate of candidates) {
    const id = String(candidate._id || candidate.id);
    const order = await Order.findOneAndUpdate(
      { _id: id, kitchenPrintStatus: 'pending' },
      { $set: { kitchenPrintStatus: 'printing' } }
    );
    if (order) claimed.push(order);
  }

  return claimed;
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

    if (blockedUntil && blockedUntil.getTime() > now.getTime()) {
      return NextResponse.json(
        { success: false, error: blockReason, blockedUntil: blockedUntil.toISOString() },
        { status: 403 }
      );
    }

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
    if (lineProductIds.length > 0) {
      const lineProducts = await Product.find({ _id: { $in: lineProductIds } })
        .select('taxRate category')
        .lean();

      // Имена категорий (для группировки в кухонном чеке): id → name.
      const catIds = Array.from(
        new Set(lineProducts.map((p) => String((p as any).category)).filter(Boolean))
      );
      const catNameById = new Map<string, string>();
      if (catIds.length > 0) {
        const cats = await Category.find({ _id: { $in: catIds } }).select('name').lean();
        for (const c of cats) catNameById.set(String((c as any)._id), (c as any).name);
      }

      for (const p of lineProducts) {
        if (typeof (p as any).taxRate === 'number' && (p as any).taxRate > 0) {
          taxRateByProduct.set(String((p as any)._id), (p as any).taxRate);
        }
        const catName = catNameById.get(String((p as any).category));
        if (catName) categoryByProduct.set(String((p as any)._id), catName);
      }
    }

    // Transform items to match Order schema
    const transformedItems = orderData.items.map((item: any) => ({
      product: item.productId || item.id, // Product ID from cart
      name: item.name,
      quantity: item.quantity,
      price: item.price, // Price per unit
      category: categoryByProduct.get(item.productId || item.id),
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
    
    // Free delivery for orders >= 30 euros
    const FREE_DELIVERY_THRESHOLD = 30;
    const effectiveDeliveryFee = (orderData.deliveryType === 'delivery' && calculatedSubtotal >= FREE_DELIVERY_THRESHOLD)
      ? 0
      : (orderData.deliveryType === 'pickup' ? 0 : (orderData.deliveryFee || 0));
    
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

    // Matchday-Kombi-Positionen nehmen NICHT an anderen Aktionen teil — wie im
    // Client (CartContext.recalculatePromotions). Sonst würde der Server für eine
    // Kombi-Bestellung ein Gratis-Angebot erzeugen, das der Kunde nie zu sehen bekam,
    // und die Bestellung fälschlich blockieren ("Bitte wählen Sie Ihr Gratis-Produkt aus").
    const promotionItems = Array.isArray(orderData.items)
      ? orderData.items.filter((i: any) => !i.comboId)
      : [];

    let promotionCalc = await calculateOrderPromotions(promotionItems, {
      channel: orderData.channel === 'app' ? 'app' : 'web',
      promoCode: promotionPromoCode || undefined,
      phoneNumber: orderData.phoneNumber,
      selectedBogoSecond,
      // AC #7: при активном купоне денежные акции не комбинируем (никогда обе скидки).
      excludeMoneyDiscounts: couponDiscount > 0,
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

    const bogoOrderItems = bogoSecondItems.map((item) => ({
      product: item.productId,
      name: item.bogoMode === 'free' ? `[GRATIS] ${item.name}` : `[AKTION] ${item.name}`,
      quantity: item.quantity,
      price: item.unitPrice,
      totalPrice: item.unitPrice * item.quantity,
    }));

    const giftOrderItems = resolvedFreeGifts.map((g) => ({
      product: g.productId,
      name: `[GRATIS] ${g.name}`,
      quantity: g.quantity,
      price: 0,
      totalPrice: 0,
    }));

    const orderItems = [...transformedItems, ...bogoOrderItems, ...giftOrderItems];

    // --- Списание баллов лояльности (сервер — источник истины) ---
    // Разрешено только авторизованному клиенту; cap (30%) и минимальная сумма
    // проверяются по серверным правилам. user_id берётся из cookie-сессии.
    const amountBeforePoints = Math.max(
      calculatedSubtotal + bogoMerchandise + effectiveDeliveryFee - couponDiscount - promotionDiscount,
      0
    );
    let loyaltyPointsUsed = 0;
    let loyaltyPointsDiscount = 0;
    const customerSession = getCustomerSession(request);
    const requestedPoints = Number(orderData.loyaltyPointsToRedeem) || 0;
    if (customerSession && requestedPoints > 0) {
      const rules = await getLoyaltyRules();
      const balance = await getBalance(customerSession.userId);
      const maxRedeemable = computeMaxRedeemablePoints(balance, amountBeforePoints, rules);
      loyaltyPointsUsed = Math.min(requestedPoints, maxRedeemable);
      loyaltyPointsDiscount = loyaltyPointsUsed * rules.pointValueEuro;
    }

    const calculatedTotal = Math.max(amountBeforePoints - loyaltyPointsDiscount, 0);

    const orderPayload = {
      customerName: orderData.customerName,
      phoneNumber: orderData.phoneNumber,
      email: orderData.email,
      // Привязка к аккаунту, если клиент авторизован (для кабинета/лояльности).
      user: customerSession?.userId,
      items: orderItems,
      deliveryType: orderData.deliveryType,
      deliveryAddress: orderData.deliveryAddress,
      deliveryZone: orderData.deliveryZone,
      deliveryFee: effectiveDeliveryFee,
      subtotal: calculatedSubtotal + bogoMerchandise,
      tax: typeof orderData.tax === 'number' ? orderData.tax : 0,
      total: calculatedTotal,
      paymentMethod: orderData.paymentMethod,
      paymentStatus: 'pending',
      status: 'new',
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
    // Для онлайн-оплаты (SumUp) откладываем до подтверждения оплаты —
    // см. /api/payments/sumup/confirm. Иначе кухня/Telegram/печать сработали бы
    // по неоплаченному заказу. Принт-агент тоже не видит неоплаченные онлайн-заказы
    // (см. GET-гейт по paymentStatus ниже).
    if (order.paymentMethod !== 'online') {
      await finalizeOrderPlacement(order, request);
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
        loyaltyPointsEarned: order.loyaltyPointsEarned || 0
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

    const query: any = {};
    if (phoneNumber) query.phoneNumber = phoneNumber;
    if (orderNumber) query.orderNumber = orderNumber;
    if (status) query.status = status;
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
      const orders = await claimPendingPrintOrders(query, limit);

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
