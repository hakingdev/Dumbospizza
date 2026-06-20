import type { NextRequest } from 'next/server';
import { Coupon } from '../models/coupon.model';
import { addLoyaltyPoints, redeemLoyaltyPoints } from '../loyalty';
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
      customizations: [
        ...(item.size ? [`Size: ${item.size.name}`] : []),
        ...(item.extras?.toppings?.map((t: any) => `Topping: ${t.name}`) || []),
        ...(item.extras?.sauces?.map((s: any) => `Sauce: ${s.name}`) || []),
        ...(item.extras?.sides?.map((s: any) => `Side: ${s.name}`) || []),
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

  // Баллы лояльности
  if (order.phoneNumber) {
    if (order.loyaltyPointsUsed && order.loyaltyPointsUsed > 0) {
      await redeemLoyaltyPoints(order.phoneNumber, order.loyaltyPointsUsed, order._id.toString());
    }
    if (order.total > 0) {
      const pointsAdded = await addLoyaltyPoints(order.phoneNumber, order.total, order._id.toString());
      if (pointsAdded) {
        order.loyaltyPointsEarned = pointsAdded.transactions.slice(-1)[0]?.amount || 0;
        await order.save();
      }
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
