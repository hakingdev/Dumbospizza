// node-telegram-bot-api export varies across builds; use require for compatibility
const TelegramBot = require('node-telegram-bot-api');
import { getSetting } from './settings';
import { connectToDatabase } from './models';
import { Order } from './models/order.model';
import type { IOrder } from './models/order.model';
import { sendOrderStatusNotification } from './whatsapp';

const botCache = new Map<string, any>();

async function getTelegramConfig() {
  const settings = await getSetting<Record<string, any>>('storeSettings', {});
  const botToken = settings?.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = settings?.telegramChatId || process.env.TELEGRAM_CHAT_ID || '';
  const webhookSecret = settings?.telegramWebhookSecret || process.env.TELEGRAM_WEBHOOK_SECRET || '';

  if (!botToken || !chatId) {
    throw new Error('Telegram bot token or chat ID is not configured');
  }

  if (!botCache.has(botToken)) {
    botCache.set(botToken, new TelegramBot(botToken, { polling: false }));
  }

  return {
    bot: botCache.get(botToken),
    chatId,
    webhookSecret
  };
}

// Order status types
export type OrderStatus = 'new' | 'preparing' | 'ready_for_delivery' | 'delivering' | 'completed' | 'cancelled';

export interface OrderNotification {
  orderId: string;
  customerName: string;
  phoneNumber: string;
  address?: string;
  notes?: string;
  items: Array<{
    name: string;
    quantity: number;
    price?: number;
    customizations?: string[];
  }>;
  totalAmount: number;
  /** Сумма заказа без доставки и скидки */
  subtotal?: number;
  deliveryFee?: number;
  /** Скидка по промокоду: сумма и тип (процент или фикс) */
  discount?: { code?: string; amount: number; type: 'percentage' | 'fixed' };
  paymentMethod: string;
  deliveryType: 'delivery' | 'pickup';
  desiredDeliveryTime?: string;
}

export interface PreOrderNotification {
  name: string;
  phone: string;
  address: string;
  email?: string;
}

/**
 * Send a pre-order (предзаказ) notification to the same Telegram chat
 */
export async function sendPreOrderNotification(data: PreOrderNotification): Promise<boolean> {
  try {
    const { bot, chatId } = await getTelegramConfig();
    const emailLine = data.email ? `\n📧 Email: ${data.email}` : '';
    const messageText = `
🛒 *ПРЕДЗАКАЗ* (Pre-Order)

👤 Имя: ${data.name}
📱 Телефон: ${data.phone}
📍 Адрес: ${data.address}${emailLine}
`;
    await bot.sendMessage(chatId, messageText.trim(), { parse_mode: 'Markdown' });
    return true;
  } catch (error) {
    console.error('Error sending pre-order to Telegram:', error);
    return false;
  }
}

/**
 * Send a new order notification to the Telegram group
 * @param order Order information to be sent
 * @returns Promise resolving to the message ID for updating status later
 */
function buildMapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Собирает текст сообщения заказа (адрес, расчёт, состав) — без строки статуса. При смене статуса пересобираем из данных заказа, чтобы не терять ссылку и форматирование. */
function buildOrderMessageText(order: OrderNotification): string {
  const itemsList = order.items.map(item => {
    const customizationsText = item.customizations?.length
      ? ` (${item.customizations.join(', ')})`
      : '';
    return `${item.quantity}x ${item.name}${customizationsText}`;
  }).join('\n');

  const mapsUrl = order.address ? buildMapsUrl(order.address) : '';
  const addressInfo = order.deliveryType === 'delivery' && order.address
    ? `📍 <a href="${mapsUrl}">${escapeHtml(order.address)}</a>`
    : '🏬 Самовывоз';

  const subtotal = order.subtotal ?? order.totalAmount;
  let sumsBlock = `🛒 Заказ: ${subtotal.toFixed(2)} €`;
  if (order.deliveryFee != null && order.deliveryFee > 0) {
    sumsBlock += `\n🚚 Доставка: ${order.deliveryFee.toFixed(2)} €`;
  }
  if (order.discount && order.discount.amount > 0) {
    const discountText = order.discount.type === 'percentage'
      ? `Промокод: -${order.discount.amount}%`
      : `Промокод: -${order.discount.amount.toFixed(2)} €`;
    const codePart = order.discount.code ? ` (${order.discount.code})` : '';
    sumsBlock += `\n🏷️ ${discountText}${codePart}`;
  }
  sumsBlock += `\n💰 <b>Итого: ${order.totalAmount.toFixed(2)} €</b>`;

  const desiredTimeLine = order.desiredDeliveryTime
    ? `\n🕐 Желаемое время: ${escapeHtml(order.desiredDeliveryTime)}`
    : '';

  return `
🔔 <b>НОВЫЙ ЗАКАЗ #${order.orderId}</b>

👤 Клиент: ${escapeHtml(order.customerName)}
📱 Телефон: ${escapeHtml(order.phoneNumber)}
${addressInfo}${desiredTimeLine}
${sumsBlock}
💳 Способ оплаты: ${escapeHtml(order.paymentMethod)}

📋 <b>Состав заказа:</b>
${itemsList.split('\n').map(line => escapeHtml(line)).join('\n')}
`.trim();
}

export async function sendOrderNotification(order: OrderNotification): Promise<number | null> {
  try {
    const { bot, chatId } = await getTelegramConfig();
    const messageText = buildOrderMessageText(order);
    const keyboard = buildStatusKeyboard(order.orderId);

    // Send the message with inline keyboard (HTML — чтобы ссылка на карты работала)
    const message = await bot.sendMessage(chatId, messageText, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });

    // Return the message ID for future reference (e.g., updating the message)
    return message.message_id;
  } catch (error) {
    console.error('Error sending Telegram notification:', error);
    return null;
  }
}

/**
 * Update an existing order status message in Telegram.
 * Если передан orderData — пересобираем весь текст из данных заказа (адрес-ссылка, расчёт доставки/промокод, итого), чтобы ничего не терялось.
 */
export async function updateOrderStatus(
  messageId: number,
  status: OrderStatus,
  orderId: string,
  originalText?: string,
  orderData?: OrderNotification
): Promise<boolean> {
  try {
    const { bot, chatId } = await getTelegramConfig();
    const statusInfo: Record<OrderStatus, string> = {
      new: '🆕 Новый',
      preparing: '🧑‍🍳 Готовится',
      ready_for_delivery: '✅ Готов к доставке',
      delivering: '🚚 В пути',
      completed: '🏁 Доставлен',
      cancelled: '❌ Отменён'
    };
    const statusLine = `Статус заказа #${orderId}: ${statusInfo[status]}`;

    const baseText = orderData
      ? buildOrderMessageText(orderData)
      : (originalText
          ? originalText
              .split('\n')
              .filter((line) => !line.startsWith('Статус заказа #'))
              .join('\n')
              .trim()
          : '');
    const nextText = baseText ? `${baseText}\n\n${statusLine}` : statusLine;

    await bot.editMessageText(nextText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      reply_markup: buildStatusKeyboard(orderId)
    });

    return true;
  } catch (error) {
    console.error('Error updating order status in Telegram:', error);
    return false;
  }
}

/**
 * Setup the webhook handler for bot callbacks
 * This should be called when the server starts
 */
export function setupTelegramWebhook(webhookUrl: string): Promise<boolean> {
  return getTelegramConfig()
    .then(({ bot }) => bot.setWebHook(webhookUrl))
    .then(() => true)
    .catch(error => {
      console.error('Error setting up Telegram webhook:', error);
      return false;
    });
}

/** Преобразует заказ из БД в формат для сообщения Telegram (адрес, расчёт, состав). */
function orderToNotification(order: IOrder): OrderNotification {
  const fullAddress = order.deliveryType === 'delivery' && order.deliveryAddress
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
        ...(item.options?.map((o: any) => `${o.group}: ${o.name}`) || [])
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
}

/**
 * Process webhook data from Telegram
 * This should be called by your API route that handles Telegram webhooks
 */
export async function processTelegramUpdate(update: any): Promise<void> {
  const { bot } = await getTelegramConfig();
  // Handle callback queries (button clicks)
  if (update.callback_query) {
    const callbackData = update.callback_query.data;
    
    // Parse status change commands
    if (callbackData.startsWith('status_')) {
      const [, statusKey, orderId] = callbackData.split('_');
      const statusMap: Record<string, OrderStatus> = {
        preparing: 'preparing',
        ready: 'ready_for_delivery',
        delivering: 'delivering',
        completed: 'completed',
        cancelled: 'cancelled'
      };
      const newStatus = statusMap[statusKey];
      if (!newStatus) {
        await bot.answerCallbackQuery(update.callback_query.id, {
          text: `Неизвестный статус: ${statusKey}`
        });
        return;
      }

      await connectToDatabase();
      const order = await Order.findOne({ orderNumber: orderId });
      if (!order) {
        await bot.answerCallbackQuery(update.callback_query.id, {
          text: `Заказ #${orderId} не найден`
        });
        return;
      }

      order.status = newStatus;
      order.statusUpdates = order.statusUpdates || [];
      order.statusUpdates.push({
        status: newStatus,
        timestamp: new Date()
      });
      await order.save();
      
      const messageId = update.callback_query.message?.message_id;
      if (messageId) {
        const orderNotification = orderToNotification(order);
        await updateOrderStatus(messageId, newStatus, orderId, undefined, orderNotification);
      }

      sendOrderStatusNotification(
        { phoneNumber: order.phoneNumber, orderNumber: order.orderNumber },
        newStatus
      ).catch((e) => console.error('WhatsApp status notification:', e));

      // Acknowledge the callback query
      await bot.answerCallbackQuery(update.callback_query.id, {
        text: `Статус заказа #${orderId} изменён`
      });
    }
  }
}

function buildStatusKeyboard(orderId: string) {
  return {
    inline_keyboard: [
      [
        { text: '🧑‍🍳 Готовится', callback_data: `status_preparing_${orderId}` },
        { text: '✅ Готов', callback_data: `status_ready_${orderId}` }
      ],
      [
        { text: '🚚 В пути', callback_data: `status_delivering_${orderId}` },
        { text: '🏁 Доставлен', callback_data: `status_completed_${orderId}` }
      ],
      [
        { text: '❌ Отменён', callback_data: `status_cancelled_${orderId}` }
      ]
    ]
  };
}
