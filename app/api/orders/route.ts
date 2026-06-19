import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../lib/models';
import { Order, type IOrder } from '../../../lib/models/order.model';
import { Product } from '../../../lib/models/product.model';
import { sendServerPurchaseConversionEvents } from '../../../lib/conversions/server-purchase-events';
import { Coupon } from '../../../lib/models/coupon.model';
import { calculateOrderPromotions, recordPromotionOrderAnalytics } from '../../../lib/promotions/order-integration';
import {
  resolveFreeGiftsForOrder,
  enrichFreeGiftOffers,
  applySelectedFreeGifts,
} from '../../../lib/promotions/gifts';
import { validateBogoSecondSelection } from '../../../lib/promotions/bogo';
import { getAppliedPromotionDiscount, getVisibleBogoSecondItems } from '../../../lib/promotions/discount-total';
import { addLoyaltyPoints, redeemLoyaltyPoints } from '../../../lib/loyalty';
import { sendOrderNotification } from '../../../lib/telegram';
import { printOrderReceipts } from '../../../lib/printing';
import { sendOrderPlacedNotification } from '../../../lib/whatsapp';
import { getSetting } from '../../../lib/settings';
import {
  formatMinutesAsHHmm,
  getNowMinutesInTimeZone,
  parseOrdersTimeToMinutes,
} from '../../../lib/order-acceptance-hours';
import { getServerSession } from 'next-auth';
import { authOptions, isStaff } from '../../../lib/auth';

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

    // Transform items to match Order schema
    const transformedItems = orderData.items.map((item: any) => ({
      product: item.productId || item.id, // Product ID from cart
      name: item.name,
      quantity: item.quantity,
      price: item.price, // Price per unit
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
    
    // Recalculate total with free delivery if applicable
    const loyaltyPointsDiscount = (orderData.loyaltyPointsToRedeem || 0) / 100;
    let couponDiscount = 0;
    let validatedCoupon: any = null;
    const couponCode = typeof orderData.couponCode === 'string' ? orderData.couponCode.trim().toUpperCase() : '';
    if (couponCode) {
      validatedCoupon = await Coupon.findOne({
        code: couponCode,
        active: true,
        validFrom: { $lte: new Date() },
        validTo: { $gte: new Date() }
      });

      if (!validatedCoupon) {
        return NextResponse.json(
          { success: false, error: 'Invalid or expired coupon' },
          { status: 400 }
        );
      }

      if (validatedCoupon.usageLimit && validatedCoupon.usageCount >= validatedCoupon.usageLimit) {
        return NextResponse.json(
          { success: false, error: 'Coupon usage limit reached' },
          { status: 400 }
        );
      }

      if (validatedCoupon.minOrderAmount && calculatedSubtotal < validatedCoupon.minOrderAmount) {
        return NextResponse.json(
          { success: false, error: `Minimum order amount not met. Required: ${validatedCoupon.minOrderAmount}€` },
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

    let promotionCalc = await calculateOrderPromotions(orderData.items, {
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

    if ((promotionCalc.freeGiftOffers || []).length > 0) {
      return NextResponse.json(
        { success: false, error: 'Bitte wählen Sie Ihr Gratis-Produkt aus.' },
        { status: 400 }
      );
    }

    // Награда BOGO опциональна (вариант «только попап»): наличие непринятого
    // оффера НЕ блокирует заказ — клиент мог отказаться («Nein, danke»).

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

    const calculatedTotal = Math.max(
      calculatedSubtotal +
        bogoMerchandise +
        effectiveDeliveryFee -
        loyaltyPointsDiscount -
        couponDiscount -
        promotionDiscount,
      0
    );

    const orderPayload = {
      customerName: orderData.customerName,
      phoneNumber: orderData.phoneNumber,
      email: orderData.email,
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
      loyaltyPointsUsed: orderData.loyaltyPointsToRedeem || 0,
      discount: couponDiscount > 0
        ? {
            code: couponCode,
            amount: couponDiscount,
            type: validatedCoupon?.discountType || 'fixed'
          }
        : undefined,
      promotionDiscount,
      promotionPromoCode: promotionPromoCode || undefined,
      appliedPromotions: promotionCalc.appliedPromotions.map((p) => ({
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

    // Process coupon if applicable
    if (validatedCoupon) {
      try {
        await validatedCoupon.use(); // Increment usage count
      } catch (error) {
        console.error('Error processing coupon:', error);
        // Don't fail the order if coupon processing fails
      }
    }

    // Record promotion analytics (don't fail the order)
    if (promotionCalc.appliedPromotions.length > 0) {
      try {
        await recordPromotionOrderAnalytics(promotionCalc.appliedPromotions, order.total);
      } catch (error) {
        console.error('Error recording promotion analytics:', error);
      }
    }

    // Process loyalty points if applicable
    if (orderData.phoneNumber) {
      // If loyalty points are being redeemed
      if (orderData.loyaltyPointsToRedeem && orderData.loyaltyPointsToRedeem > 0) {
        await redeemLoyaltyPoints(
          orderData.phoneNumber,
          orderData.loyaltyPointsToRedeem,
          order._id.toString()
        );
      }

      // Add loyalty points for this purchase
      if (order.total > 0) {
        const pointsAdded = await addLoyaltyPoints(
          orderData.phoneNumber,
          order.total,
          order._id.toString()
        );
        
        if (pointsAdded) {
          order.loyaltyPointsEarned = pointsAdded.transactions.slice(-1)[0]?.amount || 0;
          await order.save();
        }
      }
    }

    // Send notification to Telegram (async, don't block)
    const fullAddress = order.deliveryType === 'delivery' && order.deliveryAddress
      ? `${order.deliveryAddress.street} ${order.deliveryAddress.houseNumber}, ${order.deliveryAddress.postalCode} ${order.deliveryAddress.city}`.trim()
      : undefined;
    const notification = {
      orderId: order.orderNumber,
      customerName: order.customerName,
      phoneNumber: order.phoneNumber,
      address: fullAddress,
      items: order.items.map(item => ({
        name: item.name,
        quantity: item.quantity,
        customizations: [
          ...(item.size ? [`Size: ${item.size.name}`] : []),
          ...(item.extras?.toppings?.map(t => `Topping: ${t.name}`) || []),
          ...(item.extras?.sauces?.map(s => `Sauce: ${s.name}`) || []),
          ...(item.extras?.sides?.map(s => `Side: ${s.name}`) || [])
        ]
      })),
      totalAmount: order.total,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      discount: order.discount,
      paymentMethod: order.paymentMethod,
      deliveryType: order.deliveryType,
      desiredDeliveryTime: order.desiredDeliveryTime
    };

    // ВАЖНО (Vercel serverless): уведомления нужно ДОЖДАТЬСЯ до ответа,
    // иначе функция замораживается и Telegram/WhatsApp/конверсии не отправляются.
    await Promise.all([
      sendServerPurchaseConversionEvents(order.toObject() as IOrder, request).catch((err) => {
        console.error('Server conversion events (Meta / TikTok):', err);
      }),
      sendOrderPlacedNotification({ phoneNumber: order.phoneNumber, orderNumber: order.orderNumber }).catch(err => {
        console.error('Error sending WhatsApp order-placed notification:', err);
      }),
      sendOrderNotification(notification).then(messageId => {
        if (messageId) {
          order.telegramMessageId = messageId;
          return order.save();
        }
      }).catch(err => {
        console.error('Error sending Telegram notification:', err);
      }),
    ]).catch(err => {
      console.error('Error in async notifications:', err);
    });

    // Печать: прямая термопечать только на локальном сервере (где задан интерфейс
    // принтера и он в той же сети). На Vercel принтер недоступен → оставляем статус
    // 'pending', и заказ печатает принт-агент, опрашивающий /api/orders.
    const hasLocalPrinter = Boolean(
      process.env.KITCHEN_PRINTER_INTERFACE ||
      process.env.PRINTER_INTERFACE ||
      process.env.CUSTOMER_PRINTER_INTERFACE
    );
    if (hasLocalPrinter) {
      await printOrderReceipts({
        ...notification,
        notes: order.notes,
        deliveryFee: order.deliveryFee,
      })
        .then((printResult) => {
          order.kitchenPrintStatus = printResult.kitchen ? 'completed' : 'pending';
          order.customerPrintStatus = printResult.customer ? 'completed' : 'pending';
          return order.save();
        })
        .catch((err) => {
          console.error('Error printing receipts:', err);
          order.kitchenPrintStatus = 'pending';
          order.customerPrintStatus = 'pending';
          return order.save();
        });
    } else {
      // Vercel: помечаем как ожидающие печати — подхватит принт-агент
      order.kitchenPrintStatus = 'pending';
      order.customerPrintStatus = 'pending';
      await order.save();
    }

    return NextResponse.json({
      success: true, 
      order: {
        id: order._id.toString(),
        orderNumber: order.orderNumber,
        status: order.status,
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
    if (!phoneNumber && !orderNumber) {
      // Принт-агент забирает очередь печати без staff-сессии: авторизуем его тем же
      // секретом, что и /mark-printed (X-Print-Agent-Key), и только для запросов
      // очереди печати (kitchenPrintStatus задан).
      const printAgentKey = request.headers.get('X-Print-Agent-Key');
      const isPrintAgent =
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
    if (kitchenPrintStatus) query.kitchenPrintStatus = kitchenPrintStatus;

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
