// node-telegram-bot-api export varies across builds; use require for compatibility
const TelegramBot = require('node-telegram-bot-api');
import { getSetting } from './settings';
import { connectToDatabase } from './models';
import { Order } from './models/order.model';
import type { IOrder } from './models/order.model';
import { sendOrderStatusNotification, sendOrderEtaNotification } from './whatsapp';
import type { OrderEtaAnalysis } from './eta/types';
import { earnForCompletedOrder, reverseOrder } from './loyalty/service';
import { stripPromoLabels } from './orders/gift-label';
import { requestKitchenReprint } from './orders/print-queue';

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

/** Подписи статусов в сообщении Telegram (и белый список статусов заказа). */
const STATUS_INFO: Record<OrderStatus, string> = {
  new: '🆕 Новый',
  preparing: '🧑‍🍳 Готовится',
  ready_for_delivery: '✅ Готов к доставке',
  delivering: '🚚 В пути',
  completed: '🏁 Доставлен',
  cancelled: '❌ Отменён'
};

/** Статус заказа из БД может быть и `pending_payment` — в сообщении его не рисуем. */
export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && value in STATUS_INFO;
}

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
    /** Имя категории — для группировки в кухонном чеке. */
    category?: string;
    /** Имя подкатегории — подзаголовок внутри категории на кухонном чеке. */
    subcategory?: string;
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
  /** Объявленное клиенту время готовности, мин (AI или кнопка «⏱ Время готовности»). */
  etaMinutes?: number;
  /** AI-оценка: разбивка готовка/доставка, расстояние, загрузка, советы. */
  etaAnalysis?: OrderEtaAnalysis;
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

export function escapeHtml(text: string): string {
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
    // Aktions-/Gratis-Label ([GRATIS]/[AKTION]) entfernen: nur Produktname zeigen.
    const itemName = stripPromoLabels(item.name);
    return `${item.quantity}x ${itemName}${customizationsText}`;
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

  // Клиенту уже сказали время — держим его в сообщении, иначе после ухода
  // всплывашки оператор не вспомнит, что и когда пообещали.
  const etaLine = order.etaMinutes
    ? `\n⏱ Клиенту сообщено: ~${order.etaMinutes} мин`
    : '';

  // Разбивка AI-оценки: готовка/доставка/км + подсказка маршрута + совет по
  // загрузке. Персонал может поправить время кнопкой «⏱ Время готовности».
  let etaDetails = '';
  const analysis = order.etaAnalysis;
  if (analysis) {
    const parts = [`готовка ~${analysis.prepMinutes} мин`];
    if (order.deliveryType === 'delivery' && analysis.deliveryMinutes > 0) {
      const km = analysis.distanceKm != null ? `, ${analysis.distanceKm} км` : '';
      parts.push(`доставка ~${analysis.deliveryMinutes} мин${km}`);
    }
    const sourceMark = analysis.source === 'ai' ? '🤖 AI' : '🤖 Оценка (без AI)';
    etaDetails = `\n${sourceMark}: ${parts.join(', ')}`;
    if (analysis.routeHint) etaDetails += `\n🗺 ${escapeHtml(analysis.routeHint)}`;
    if (analysis.advisory) etaDetails += `\n⚠️ ${escapeHtml(analysis.advisory)}`;
  }

  return `
🔔 <b>НОВЫЙ ЗАКАЗ #${order.orderId}</b>

👤 Клиент: ${escapeHtml(order.customerName)}
📱 Телефон: ${escapeHtml(order.phoneNumber)}
${addressInfo}${desiredTimeLine}${etaLine}${etaDetails}
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
    const statusLine = `Статус заказа #${orderId}: ${STATUS_INFO[status]}`;

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
      price: item.price,
      category: item.category,
      customizations: [
        ...(item.size ? [`Size: ${item.size.name}`] : []),
        ...(item.extras?.toppings?.map((t: any) => `Topping: ${t.name}`) || []),
        ...(item.extras?.sauces?.map((s: any) => `Sauce: ${s.name}`) || []),
        ...(item.extras?.sides?.map((s: any) => `Side: ${s.name}`) || []),
        ...(item.options?.map((o: any) => (o.group ? `${o.group}: ${o.name}` : o.name)) || [])
      ]
    })),
    totalAmount: order.total,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    discount: order.discount,
    paymentMethod: order.paymentMethod,
    deliveryType: order.deliveryType,
    desiredDeliveryTime: order.desiredDeliveryTime,
    etaMinutes: order.etaMinutes,
    etaAnalysis: order.etaAnalysis || undefined
  };
}

/**
 * Служебное сообщение в основной чат заказов (HTML). Используется для
 * алертов о пиковой загрузке кухни (lib/orders/finalize.ts).
 */
export async function sendPlainTelegramMessage(html: string): Promise<boolean> {
  try {
    const { bot, chatId } = await getTelegramConfig();
    await bot.sendMessage(chatId, html, { parse_mode: 'HTML' });
    return true;
  } catch (error) {
    console.error('Error sending Telegram message:', error);
    return false;
  }
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

/**
 * Разбор callback_data вида `reprint_<orderNumber>` — кнопка «🖨 Чек ещё раз».
 * Возвращает null, если это не наша кнопка.
 */
export function parseReprintCallback(data: unknown): { orderNumber: string } | null {
  if (typeof data !== 'string' || !data.startsWith('reprint_')) return null;
  const orderNumber = data.slice('reprint_'.length);
  return orderNumber ? { orderNumber } : null;
}

export interface ReprintCallbackDeps {
  answerCallbackQuery: (id: string, opts?: { text?: string; show_alert?: boolean }) => PromiseLike<unknown>;
  findOrder: (orderNumber: string) => PromiseLike<any | null>;
  /** Ставит кухонный чек в очередь новым заданием; null = заказ печатать нельзя. */
  requestReprint: (orderId: string) => PromiseLike<any | null>;
  log?: (...args: any[]) => void;
}

export type ReprintCallbackResult = {
  handled: boolean;
  reason?: 'not_reprint_callback' | 'order_not_found' | 'lookup_error' | 'rejected' | 'queued';
};

/**
 * Ядро обработки клика по «🖨 Чек ещё раз». Как и у кнопок статуса: изолировано
 * от Telegram/БД через deps, answerCallbackQuery вызывается всегда.
 *
 * Ответ оператору намеренно говорит «в очереди», а не «напечатано»: печатает
 * агент на кассовом ПК, сервер знает только о постановке в очередь.
 */
export async function handleReprintCallbackQuery(
  cbq: any,
  deps: ReprintCallbackDeps
): Promise<ReprintCallbackResult> {
  const log = deps.log || ((...a: any[]) => console.log('[telegram]', ...a));
  const id: string = cbq?.id;
  const ack = async (opts?: { text?: string; show_alert?: boolean }) => {
    if (!id) return;
    try {
      await deps.answerCallbackQuery(id, opts);
    } catch (e) {
      log('answerCallbackQuery failed', (e as Error)?.message);
    }
  };

  const parsed = parseReprintCallback(cbq?.data);
  if (!parsed) {
    await ack();
    return { handled: false, reason: 'not_reprint_callback' };
  }

  log('reprint requested', { orderNumber: parsed.orderNumber });

  let order: any;
  try {
    order = await deps.findOrder(parsed.orderNumber);
  } catch (e) {
    log('order lookup failed', (e as Error)?.message);
    await ack({ text: 'Fehler beim Laden der Bestellung', show_alert: true });
    return { handled: false, reason: 'lookup_error' };
  }

  if (!order) {
    log('order not found', parsed.orderNumber);
    await ack({ text: `Заказ #${parsed.orderNumber} не найден`, show_alert: true });
    return { handled: false, reason: 'order_not_found' };
  }

  let queued: any = null;
  try {
    queued = await deps.requestReprint(String(order._id || order.id));
  } catch (e) {
    log('reprint request failed', (e as Error)?.message);
    await ack({ text: 'Не удалось поставить чек в печать', show_alert: true });
    return { handled: false, reason: 'lookup_error' };
  }

  if (!queued) {
    await ack({
      text: `Заказ #${parsed.orderNumber} нельзя напечатать: не подтверждена оплата`,
      show_alert: true,
    });
    return { handled: false, reason: 'rejected' };
  }

  await ack({ text: `🖨 Чек #${parsed.orderNumber} — в очереди на печать` });
  return { handled: true, reason: 'queued' };
}

/** Пресеты времени готовности (минуты) на кнопках «⏱ Время готовности». */
export const ETA_PRESETS = [30, 45, 60, 90, 120] as const;

/** Границы значения из callback_data — защита от мусора и опечаток в пресетах. */
const ETA_MIN_MINUTES = 1;
const ETA_MAX_MINUTES = 600;

export type EtaCallback =
  | { action: 'menu'; orderId: string }
  | { action: 'back'; orderId: string }
  | { action: 'set'; minutes: number; orderId: string };

/**
 * Разбор callback_data кнопок времени готовности:
 *   `eta_menu_<orderNumber>`           — показать пресеты,
 *   `eta_back_<orderNumber>`           — вернуться к основной клавиатуре,
 *   `eta_set_<minutes>_<orderNumber>`  — объявить время клиенту.
 * Делим по ПЕРВОМУ '_' (как parseStatusCallback): orderNumber может содержать '_'.
 */
export function parseEtaCallback(data: unknown): EtaCallback | null {
  if (typeof data !== 'string' || !data.startsWith('eta_')) return null;
  const rest = data.slice('eta_'.length);
  const i = rest.indexOf('_');
  if (i <= 0) return null;

  const action = rest.slice(0, i);
  const tail = rest.slice(i + 1);
  if (!tail) return null;

  if (action === 'menu' || action === 'back') return { action, orderId: tail };
  if (action !== 'set') return null;

  const j = tail.indexOf('_');
  if (j <= 0) return null;
  const minutes = Number(tail.slice(0, j));
  const orderId = tail.slice(j + 1);
  if (!orderId) return null;
  if (!Number.isInteger(minutes) || minutes < ETA_MIN_MINUTES || minutes > ETA_MAX_MINUTES) {
    return null;
  }
  return { action: 'set', minutes, orderId };
}

export interface EtaCallbackDeps {
  answerCallbackQuery: (id: string, opts?: { text?: string; show_alert?: boolean }) => PromiseLike<unknown>;
  findOrder: (orderNumber: string) => PromiseLike<any | null>;
  /** Заменить основную клавиатуру рядом пресетов. */
  showEtaMenu?: (messageId: number, orderId: string) => Promise<void>;
  /** Вернуть основную клавиатуру, не трогая текст. */
  showMainKeyboard?: (messageId: number, orderId: string) => Promise<void>;
  /** Перерисовать сообщение из данных заказа (текст + основная клавиатура). */
  refreshMessage?: (messageId: number, order: any) => Promise<void>;
  /** Отправка клиенту; false = не доставлено — оператор должен об этом узнать. */
  notifyCustomer: (order: any, minutes: number) => PromiseLike<boolean>;
  log?: (...args: any[]) => void;
}

export type EtaCallbackResult = {
  handled: boolean;
  minutes?: number;
  reason?:
    | 'not_eta_callback'
    | 'menu_shown'
    | 'menu_closed'
    | 'order_not_found'
    | 'lookup_error'
    | 'save_error'
    | 'unchanged'
    | 'sent'
    | 'send_failed';
};

/**
 * Ядро обработки кнопок времени готовности. Как и у статусов/реприна: изоляция
 * от Telegram/БД через deps, answerCallbackQuery вызывается всегда.
 *
 * Отличие от статусов: ack идёт ПОСЛЕ отправки клиенту, потому что оператору
 * важен именно результат доставки — «сохранено, но не отправлено» он должен
 * увидеть сразу, а не искать в логах.
 */
export async function handleEtaCallbackQuery(
  cbq: any,
  deps: EtaCallbackDeps
): Promise<EtaCallbackResult> {
  const log = deps.log || ((...a: any[]) => console.log('[telegram]', ...a));
  const id: string = cbq?.id;
  const ack = async (opts?: { text?: string; show_alert?: boolean }) => {
    if (!id) return;
    try {
      await deps.answerCallbackQuery(id, opts);
    } catch (e) {
      log('answerCallbackQuery failed', (e as Error)?.message);
    }
  };

  const parsed = parseEtaCallback(cbq?.data);
  if (!parsed) {
    await ack();
    return { handled: false, reason: 'not_eta_callback' };
  }

  const messageId: number | undefined = cbq?.message?.message_id;
  const swapKeyboard = async (
    fn: EtaCallbackDeps['showEtaMenu'] | EtaCallbackDeps['showMainKeyboard'],
    orderId: string,
    label: string
  ) => {
    if (!messageId || !fn) return;
    try {
      await fn(messageId, orderId);
    } catch (e) {
      log(`${label} failed`, (e as Error)?.message);
    }
  };

  if (parsed.action === 'menu') {
    await ack();
    await swapKeyboard(deps.showEtaMenu, parsed.orderId, 'showEtaMenu');
    return { handled: true, reason: 'menu_shown' };
  }

  if (parsed.action === 'back') {
    await ack();
    await swapKeyboard(deps.showMainKeyboard, parsed.orderId, 'showMainKeyboard');
    return { handled: true, reason: 'menu_closed' };
  }

  const { minutes } = parsed;
  log('eta requested', { orderNumber: parsed.orderId, minutes });

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

  // Идемпотентность: то же время — не шлём клиенту второе сообщение. Каждое
  // WhatsApp-уведомление платное и читается как «время опять изменилось».
  if (order.etaMinutes === minutes) {
    await ack({ text: `Клиенту уже сообщено: ~${minutes} мин` });
    await swapKeyboard(deps.showMainKeyboard, parsed.orderId, 'showMainKeyboard');
    return { handled: true, minutes, reason: 'unchanged' };
  }

  try {
    order.etaMinutes = minutes;
    order.etaSetAt = new Date();
    await order.save();
    log('eta saved', { orderNumber: parsed.orderId, minutes });
  } catch (e) {
    log('order save failed', (e as Error)?.message);
    await ack({ text: 'Zeit konnte nicht gespeichert werden', show_alert: true });
    return { handled: false, reason: 'save_error' };
  }

  let delivered = false;
  try {
    delivered = await deps.notifyCustomer(order, minutes);
  } catch (e) {
    log('notifyCustomer failed', (e as Error)?.message);
  }

  await ack(
    delivered
      ? { text: `⏱ ${minutes} мин — клиенту отправлено` }
      : {
          text: `⏱ ${minutes} мин сохранено, но сообщение клиенту НЕ отправлено`,
          show_alert: true,
        }
  );

  if (messageId && deps.refreshMessage) {
    try {
      await deps.refreshMessage(messageId, order);
    } catch (e) {
      log('refreshMessage failed', (e as Error)?.message);
    }
  }

  return { handled: true, minutes, reason: delivered ? 'sent' : 'send_failed' };
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

  const { bot, chatId } = await getTelegramConfig();
  await connectToDatabase();

  // Разводим кнопки по префиксу callback_data ДО обработчиков: иначе каждый
  // ответил бы на чужой клик своим answerCallbackQuery (двойной ack).
  if (parseEtaCallback(update.callback_query?.data)) {
    await handleEtaCallbackQuery(update.callback_query, {
      answerCallbackQuery: (cbId, opts) => bot.answerCallbackQuery(cbId, opts),
      findOrder: (orderNumber) => Order.findOne({ orderNumber }),
      showEtaMenu: async (messageId, orderId) => {
        await bot.editMessageReplyMarkup(buildEtaKeyboard(orderId), {
          chat_id: chatId,
          message_id: messageId,
        });
      },
      showMainKeyboard: async (messageId, orderId) => {
        await bot.editMessageReplyMarkup(buildStatusKeyboard(orderId), {
          chat_id: chatId,
          message_id: messageId,
        });
      },
      refreshMessage: async (messageId, order) => {
        // Пересобираем текст, чтобы в сообщении осталось «Клиенту сообщено».
        // Заодно возвращается основная клавиатура (внутри buildStatusKeyboard).
        if (!isOrderStatus(order.status)) {
          await bot.editMessageReplyMarkup(buildStatusKeyboard(order.orderNumber), {
            chat_id: chatId,
            message_id: messageId,
          });
          return;
        }
        await updateOrderStatus(
          messageId,
          order.status,
          order.orderNumber,
          undefined,
          orderToNotification(order)
        );
      },
      notifyCustomer: (order, minutes) =>
        sendOrderEtaNotification(
          { phoneNumber: order.phoneNumber, orderNumber: order.orderNumber },
          minutes
        ),
    });
    return;
  }

  if (parseReprintCallback(update.callback_query?.data)) {
    await handleReprintCallbackQuery(update.callback_query, {
      answerCallbackQuery: (cbId, opts) => bot.answerCallbackQuery(cbId, opts),
      findOrder: (orderNumber) => Order.findOne({ orderNumber }),
      requestReprint: (orderId) =>
        requestKitchenReprint(orderId, { requestedBy: 'telegram' }),
    });
    return;
  }

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
      ],
      [
        // Время готовности → WhatsApp клиенту (lib/whatsapp.ts). Двухшаговая:
        // клик открывает пресеты, чтобы не раздувать основную клавиатуру.
        { text: '⏱ Время готовности', callback_data: `eta_menu_${orderId}` }
      ],
      [
        // Повторная печать кухонного чека — та же операция, что кнопка «Печать»
        // в админке (lib/orders/print-queue.ts → requestKitchenReprint).
        { text: '🖨 Чек ещё раз', callback_data: `reprint_${orderId}` }
      ]
    ]
  };
}

/** Ряд пресетов времени готовности + возврат к основной клавиатуре. */
function buildEtaKeyboard(orderId: string) {
  const presets = ETA_PRESETS.map((m) => ({
    text: `${m} мин`,
    callback_data: `eta_set_${m}_${orderId}`
  }));
  return {
    inline_keyboard: [
      presets.slice(0, 3),
      presets.slice(3),
      [{ text: '◀️ Назад', callback_data: `eta_back_${orderId}` }]
    ]
  };
}
