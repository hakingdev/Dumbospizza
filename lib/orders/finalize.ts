import type { NextRequest } from 'next/server';
import { Coupon } from '../models/coupon.model';
import { redeemPointsForOrder } from '../loyalty/service';
import { getLoyaltyRules } from '../loyalty/config';
import { recordPromotionOrderAnalytics } from '../promotions/order-integration';
import { sendServerPurchaseConversionEvents } from '../conversions/server-purchase-events';
import { sendOrderNotification } from '../telegram';
import { printOrderReceipts } from '../printing';
import { sendOrderPlacedNotification } from '../whatsapp';
import type { IOrder } from '../models/order.model';

/** Сборка payload уведомления (Telegram / печать) из документа заказа. */
export function buildOrderNotification(order: any) {
  const fullAddress =
    order.deliveryType === 'delivery' && order.deliveryAddress
      ? `${order.deliveryAddress.street} ${order.deliveryAddress.houseNumber}, ${order.deliveryAddress.postalCode} ${order.deliveryAddress.city}`.trim()
      : undefined;

  return {
    orderId: order.orderNumber,
    customerName: order.customerName,
    phoneNumber: order.phoneNumber,
    address: fullAddress,
    items: order.items.map((item: any) => ({
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      category: item.category,
      customizations: [
        ...(item.size ? [`Size: ${item.size.name}`] : []),
        ...(item.extras?.toppings?.map((t: any) => `Topping: ${t.name}`) || []),
        ...(item.extras?.sauces?.map((s: any) => `Sauce: ${s.name}`) || []),
        ...(item.extras?.sides?.map((s: any) => `Side: ${s.name}`) || []),
        // Допы из групп опций (соусы/топпинги/...) — Lieferando-стиль
        ...(item.options?.map((o: any) => (o.group ? `${o.group}: ${o.name}` : o.name)) || []),
      ],
    })),
    totalAmount: order.total,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    discount: order.discount,
    paymentMethod: order.paymentMethod,
    deliveryType: order.deliveryType,
    desiredDeliveryTime: order.desiredDeliveryTime,
  };
}

/**
 * Побочные эффекты размещённого заказа: списание купона, лояльность, аналитика
 * акций, уведомления (Telegram / WhatsApp / серверные конверсии) и печать чеков.
 *
 * Для оплаты при получении (cash/card) вызывается сразу при создании заказа.
 * Для онлайн-оплаты (SumUp) — ТОЛЬКО после подтверждения оплаты (status PAID),
 * чтобы кухня/Telegram/печать не запускались по неоплаченному заказу.
 *
 * Функция самодостаточна (восстанавливает всё из документа заказа), поэтому её
 * можно вызвать из отдельного запроса подтверждения оплаты. Идемпотентность
 * обеспечивает вызывающий код через paymentStatus.
 */
export async function finalizeOrderPlacement(order: any, request: NextRequest): Promise<void> {
  // Купон: списать использование (лимиты уже проверены при создании заказа)
  if (order.discount?.code) {
    try {
      const coupon = await Coupon.findOne({ code: order.discount.code, active: true });
      if (coupon) await coupon.use();
    } catch (error) {
      console.error('Error processing coupon:', error);
    }
  }

  // Аналитика акций (не валим заказ при ошибке)
  if (Array.isArray(order.appliedPromotions) && order.appliedPromotions.length > 0) {
    try {
      await recordPromotionOrderAnalytics(order.appliedPromotions, order.total);
    } catch (error) {
      console.error('Error recording promotion analytics:', error);
    }
  }

  // Баллы лояльности: СПИСАНИЕ фиксируется при размещении заказа (атомарно).
  // НАЧИСЛЕНИЕ перенесено на статус completed (см. lib/loyalty/service.ts
  // earnForCompletedOrder, вызывается из PUT /api/orders/[id]).
  //
  // ВАЖНО (баг «Punkte не уменьшаются»): сумма заказа и order.loyaltyPointsUsed
  // фиксируются ещё при СОЗДАНИИ заказа (POST /api/orders), а фактическое списание
  // баллов идёт здесь. Раньше результат redeem полностью проглатывался: если
  // списание не проходило (недостаточно баллов / over-cap / нет программы / сбой),
  // заказ всё равно оставался со «списанными» 1.68 и заниженной суммой, но
  // loyalty_programs.balance НЕ уменьшался → orders.loyalty_points_used расходился
  // с балансом, и в кабинете Verfügbare Punkte не падали. Теперь мы проверяем
  // результат и приводим заказ к РЕАЛЬНО списанному количеству (инвариант:
  // loyaltyPointsUsed на финализированном заказе всегда равен реальному списанию).
  if (order.loyaltyPointsUsed && order.loyaltyPointsUsed > 0) {
    try {
      const result = await redeemPointsForOrder(order);
      const recorded = Number(order.loyaltyPointsUsed) || 0;
      const redeemed = Number(result.redeemed) || 0;
      if (!result.success && result.reason !== 'no_points' && redeemed !== recorded) {
        console.error(
          `Loyalty redeem not applied for order ${order.orderNumber || order._id} ` +
            `(reason=${result.reason}): recorded=${recorded}, redeemed=${redeemed}`
        );
        // Не оставляем на заказе баллы, которых нет в журнале списаний.
        order.loyaltyPointsUsed = redeemed;
        // Заказ ещё не оплачен (cash/card финализируются до оплаты) → возвращаем
        // «скидку баллами» в сумму к оплате, чтобы деньги сходились с позициями.
        // Для онлайн-оплаты (paymentStatus уже 'completed') сумму НЕ трогаем —
        // она уже списана; здесь только фиксируем фактическое (не)списание.
        if (order.paymentStatus !== 'completed') {
          const { pointValueEuro } = await getLoyaltyRules();
          const refundEuro = (recorded - redeemed) * pointValueEuro;
          if (refundEuro > 0) {
            order.total = Number(order.total || 0) + refundEuro;
          }
        }
        await order.save();
      }
    } catch (error) {
      console.error('Error redeeming loyalty points:', error);
    }
  }

  const notification = buildOrderNotification(order);

  // ВАЖНО (Vercel serverless): уведомления нужно ДОЖДАТЬСЯ до ответа,
  // иначе функция замораживается и Telegram/WhatsApp/конверсии не отправляются.
  await Promise.all([
    sendServerPurchaseConversionEvents(order.toObject() as IOrder, request).catch((err) => {
      console.error('Server conversion events (Meta / TikTok):', err);
    }),
    sendOrderPlacedNotification({ phoneNumber: order.phoneNumber, orderNumber: order.orderNumber }).catch((err) => {
      console.error('Error sending WhatsApp order-placed notification:', err);
    }),
    sendOrderNotification(notification)
      .then((messageId) => {
        if (messageId) {
          order.telegramMessageId = messageId;
          return order.save();
        }
      })
      .catch((err) => {
        console.error('Error sending Telegram notification:', err);
      }),
  ]).catch((err) => {
    console.error('Error in async notifications:', err);
  });

  // Печать: прямая термопечать только на локальном сервере (где задан интерфейс
  // принтера). На Vercel принтер недоступен → оставляем 'pending', и заказ
  // печатает принт-агент, опрашивающий /api/orders?kitchenPrintStatus=pending.
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
    order.kitchenPrintStatus = 'pending';
    order.customerPrintStatus = 'pending';
    await order.save();
  }
}
