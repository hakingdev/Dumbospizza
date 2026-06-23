// node-telegram-bot-api export varies across builds; use require for compatibility
const TelegramBot = require('node-telegram-bot-api');
import { getSetting } from './settings';
import { connectToDatabase } from './models';
import { Order } from './models/order.model';
import type { IOrder } from './models/order.model';
import { sendOrderStatusNotification } from './whatsapp';
import { earnForCompletedOrder, reverseOrder } from './loyalty/service';

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
/** Маппинг ключа из callback_data → внутренний статус заказа. */
export const TELEGRAM_STATUS_MAP: Record<string, OrderStatus> = {
  preparing: 'preparing',
  ready: 'ready_for_delivery',
  delivering: 'delivering',
  completed: 'completed',
  cancelled: 'cancelled',
};

/**
 * Разбор callback_data вида `status_<statusKey>_<orderId>`.
 * statusKey не содержит '_', поэтому делим по ПЕРВОМУ '_' после префикса —
 * orderId может содержать что угодно. Возвращает null, если это не наша кнопка.
 */
export function parseStatusCallback(
  data: unknown
): { statusKey: string; orderId: string } | null {
  if (typeof data !== 'string' || !data.startsWith('status_')) return null;
  const rest = data.slice('status_'.length);
  const i = rest.indexOf('_');
  if (i <= 0) return null;
  const statusKey = rest.slice(0, i);
  const orderId = rest.slice(i + 1);
  if (!statusKey || !orderId) return null;
  return { statusKey, orderId };
}

/** Ключ статуса → внутренний статус, либо null если неизвестен. */
export function resolveTelegramStatus(statusKey: string): OrderStatus | null {
  return TELEGRAM_STATUS_MAP[statusKey] ?? null;
}

export interface StatusCallbackDeps {
  answerCallbackQuery: (id: string, opts?: { text?: string; show_alert?: boolean }) => PromiseLike<unknown>;
  findOrder: (orderNumber: string) => PromiseLike<any | null>;
  editMessage?: (messageId: number, status: OrderStatus, orderId: string, order: any) => Promise<void>;
  onStatusChanged?: (order: any, status: OrderStatus) => void | Promise<void>;
  log?: (...args: any[]) => void;
}

export type StatusCallbackResult = {
  handled: boolean;
  status?: OrderStatus;
  reason?:
    | 'not_status_callback'
    | 'invalid_status'
    | 'order_not_found'
    | 'lookup_error'
    | 'save_error'
    | 'unchanged'
    | 'updated';
};

/**
 * Ядро обработки клика по кнопке статуса. Изолировано от Telegram/БД через deps —
 * тестируется моками. ГАРАНТИЯ: answerCallbackQuery вызывается всегда (нет вечного
 * loading), а лишние side-effects (editMessage/WhatsApp) — best-effort.
 */
export async function handleStatusCallbackQuery(
  cbq: any,
  deps: StatusCallbackDeps
): Promise<StatusCallbackResult> {
  const log = deps.log || ((...a: any[]) => console.log('[telegram]', ...a));
  const id: string = cbq?.id;
  // answerCallbackQuery никогда не должен ронять обработку.
  const ack = async (opts?: { text?: string; show_alert?: boolean }) => {
    if (!id) return;
    try {
      await deps.answerCallbackQuery(id, opts);
    } catch (e) {
      log('answerCallbackQuery failed', (e as Error)?.message);
    }
  };

  log('received callback_query', { id, data: cbq?.data });

  const parsed = parseStatusCallback(cbq?.data);
  if (!parsed) {
    await ack();
    return { handled: false, reason: 'not_status_callback' };
  }

  const status = resolveTelegramStatus(parsed.statusKey);
  if (!status) {
    log('invalid status', parsed.statusKey);
    await ack({ text: `Неизвестный статус: ${parsed.statusKey}`, show_alert: true });
    return { handled: false, reason: 'invalid_status' };
  }

  log('parsed', { orderId: parsed.orderId, status });

  let order: any;
  try {
    order = await deps.findOrder(parsed.orderId);
  } catch (e) {
    log('order lookup failed', (e as Error)?.message);
    await ack({ text: 'Fehler beim Laden der Bestellung', show_alert: true });
    return { handled: false, reason: 'lookup_error' };
  }

  if (!order) {
    log('order not found', parsed.orderId);
    await ack({ text: `Заказ #${parsed.orderId} не найден`, show_alert: true });
    return { handled: false, reason: 'order_not_found' };
  }

  // Идемпотентность: статус уже такой — спокойно подтверждаем, без записи.
  if (order.status === status) {
    log('status unchanged (idempotent)', { orderId: parsed.orderId, status });
    await ack({ text: `Статус уже: ${status}` });
    return { handled: true, status, reason: 'unchanged' };
  }

  try {
    order.status = status;
    order.statusUpdates = order.statusUpdates || [];
    order.statusUpdates.push({ status, timestamp: new Date() });
    await order.save();
    log('status updated', { orderId: parsed.orderId, status });
  } catch (e) {
    log('order save failed', (e as Error)?.message);
    await ack({ text: 'Status konnte nicht gespeichert werden', show_alert: true });
    return { handled: false, reason: 'save_error' };
  }

  // Сначала подтверждаем клик (снимаем loading), потом — best-effort side-effects.
  await ack({ text: `Статус заказа #${parsed.orderId} → ${status}` });

  try {
    // Дожидаемся (важно на serverless): здесь висят начисление баллов и т.п.
    await deps.onStatusChanged?.(order, status);
  } catch (e) {
    log('onStatusChanged failed', (e as Error)?.message);
  }

  const messageId = cbq?.message?.message_id;
  if (messageId && deps.editMessage) {
    try {
      await deps.editMessage(messageId, status, parsed.orderId, order);
    } catch (e) {
      log('editMessage failed', (e as Error)?.message);
    }
  }

  return { handled: true, status, reason: 'updated' };
}

/**
 * Обработка webhook-обновления от Telegram. Вызывается из API-роута.
 */
export async function processTelegramUpdate(update: any): Promise<void> {
  if (!update?.callback_query) return;

  const { bot } = await getTelegramConfig();
  await connectToDatabase();

  await handleStatusCallbackQuery(update.callback_query, {
    answerCallbackQuery: (cbId, opts) => bot.answerCallbackQuery(cbId, opts),
    findOrder: (orderNumber) => Order.findOne({ orderNumber }),
    editMessage: async (messageId, status, orderId, order) => {
      await updateOrderStatus(messageId, status, orderId, undefined, orderToNotification(order));
    },
    onStatusChanged: async (order, status) => {
      // Баллы лояльности по смене статуса из Telegram (та же логика, что в
      // PUT /api/orders/[id]): completed → начислить, cancelled → реверс.
      // Идемпотентно по (order, type), поэтому повторный клик не дублирует.
      if (status === 'completed') {
        await earnForCompletedOrder(order).catch((e) =>
          console.error('Loyalty earn on Telegram completion:', e)
        );
      } else if (status === 'cancelled') {
        await reverseOrder(order).catch((e) =>
          console.error('Loyalty reverse on Telegram cancel:', e)
        );
      }

      sendOrderStatusNotification(
        { phoneNumber: order.phoneNumber, orderNumber: order.orderNumber },
        status
      ).catch((e) => console.error('WhatsApp status notification:', e));
    },
  });
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
