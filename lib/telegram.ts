// node-telegram-bot-api export varies across builds; use require for compatibility
const TelegramBot = require('node-telegram-bot-api');
import { getSetting } from './settings';
import { connectToDatabase } from './models';
import { Order } from './models/order.model';
import type { IOrder } from './models/order.model';
import { sendOrderStatusNotification, sendOrderEtaNotification } from './whatsapp';
import { earnForCompletedOrder, reverseOrder } from './loyalty/service';
import { requestKitchenReprint } from './orders/print-queue';
import { applyOrderDelay, isValidDelayMinutes, ORDER_DELAY_CHOICES } from './orders/delay';
import {
  buildOrderMessageText,
  escapeHtml,
  type OrderNotification,
} from './telegram/order-message';
import { cardStatusForOrderStatus, getForumConfig } from './telegram/forum';
import {
  assignCardCourier,
  checkUndoWindow,
  createOrderCard,
  moveOrderCard,
  recordDeliveryProblem,
  refreshOrderCard,
  setCardKeyboard,
  type CardOrderInput,
} from './telegram/card-mover';
import {
  parseCardCallback,
  problemLabel,
  renderCourierKeyboard,
  renderProblemKeyboard,
} from './telegram/card-render';

// Текст сообщения о заказе живёт в ./telegram/order-message — общий рендер для
// обычного сообщения и для карточки форума. Реэкспорт, чтобы существующие
// импорты (lib/printing.ts, lib/orders/finalize.ts) не менялись.
export { escapeHtml, buildOrderMessageText };
export type { OrderNotification };

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
/**
 * Отправка заказа в группу.
 *
 * В режиме форума карточка уходит в тему «🔥 Готовится» и записывается в
 * order_cards. Если форум выключен ИЛИ карточку отправить не удалось —
 * работаем по-старому: одно сообщение в чат. Заказ обязан долететь до кухни
 * даже при неверно настроенных темах.
 *
 * @param orderRef orders.id — нужен только форуму (первичный ключ карточки).
 */
export async function sendOrderNotification(
  order: OrderNotification,
  orderRef?: { orderId: string; createdAt?: Date | string | null }
): Promise<number | null> {
  if (orderRef?.orderId) {
    try {
      const created = await createOrderCard(
        {
          orderId: orderRef.orderId,
          orderNumber: order.orderId,
          createdAt: orderRef.createdAt,
          notification: order,
        },
        'cooking'
      );
      if (created) return created.messageId;
    } catch (error) {
      console.error('Error sending Telegram order card:', error);
    }
  }

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

/** Заказ из БД → вход для рендера карточки форума. */
export function toCardOrderInput(order: any): CardOrderInput {
  return {
    orderId: String(order._id ?? order.id),
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    notification: orderToNotification(order as IOrder),
  };
}

/**
 * Синхронизировать карточку форума со статусом заказа. Вызывается отовсюду,
 * где статус меняется НЕ кнопкой бота (админка, автоматика): без этого
 * карточка осталась бы в теме прошлого статуса.
 *
 * Best-effort: Telegram не должен ронять смену статуса заказа.
 */
export async function syncOrderCardStatus(order: any, status: unknown): Promise<void> {
  const target = cardStatusForOrderStatus(status);
  if (!target || !order?.orderNumber) return;
  try {
    await moveOrderCard(toCardOrderInput(order), target);
  } catch (error) {
    console.error('Error moving Telegram order card:', error);
  }
}

/**
 * Служебное сообщение в основной чат заказов (HTML). Используется для
 * алертов о пиковой загрузке кухни (lib/orders/finalize.ts).
 */
export async function sendPlainTelegramMessage(html: string): Promise<boolean> {
  try {
    const { bot, chatId } = await getTelegramConfig();
    // В форуме сообщение без message_thread_id уходит в тему General, которую
    // в группе часто закрывают/прячут. Алерты кухни адресуем в «Готовится» —
    // туда и так смотрят во время загрузки.
    const forum = await getForumConfig();
    await bot.sendMessage(chatId, html, {
      parse_mode: 'HTML',
      ...(forum ? { message_thread_id: forum.topics.cooking } : {}),
    });
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

// ---------------------------------------------------------------------------
// Кнопка «⏳ Продлить» — сдвиг обещанного времени + WhatsApp клиенту
// (готовый Twilio-шаблон задержки, lib/orders/delay.ts)
// ---------------------------------------------------------------------------

export type DelayCallback =
  | { action: 'menu'; orderId: string }
  | { action: 'back'; orderId: string }
  | { action: 'set'; minutes: number; orderId: string };

/**
 * Разбор callback_data кнопок продления:
 *   `delay_menu_<orderNumber>`           — показать пресеты «+N мин»,
 *   `delay_back_<orderNumber>`           — вернуться к основной клавиатуре,
 *   `delay_set_<minutes>_<orderNumber>`  — продлить и уведомить клиента.
 * Делим по ПЕРВОМУ '_' (как parseEtaCallback): orderNumber может содержать '_'.
 */
export function parseDelayCallback(data: unknown): DelayCallback | null {
  if (typeof data !== 'string' || !data.startsWith('delay_')) return null;
  const rest = data.slice('delay_'.length);
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
  if (!isValidDelayMinutes(minutes)) return null;
  return { action: 'set', minutes, orderId };
}

export interface DelayCallbackDeps {
  answerCallbackQuery: (id: string, opts?: { text?: string; show_alert?: boolean }) => PromiseLike<unknown>;
  findOrder: (orderNumber: string) => PromiseLike<any | null>;
  /** Продлить заказ: сдвиг etaMinutes + WhatsApp клиенту (lib/orders/delay.ts). */
  applyDelay: (orderDbId: string, minutes: number) => PromiseLike<{
    ok: boolean;
    etaMinutes?: number;
    whatsappSent: boolean;
  }>;
  /** Заменить основную клавиатуру рядом пресетов «+N мин». */
  showDelayMenu?: (messageId: number, orderId: string) => Promise<void>;
  /** Вернуть основную клавиатуру, не трогая текст. */
  showMainKeyboard?: (messageId: number, orderId: string) => Promise<void>;
  /** Перерисовать сообщение из данных заказа (обновить «Клиенту сообщено»). */
  refreshMessage?: (messageId: number, order: any) => Promise<void>;
  log?: (...args: any[]) => void;
}

export type DelayCallbackResult = {
  handled: boolean;
  minutes?: number;
  reason?:
    | 'not_delay_callback'
    | 'menu_shown'
    | 'menu_closed'
    | 'order_not_found'
    | 'lookup_error'
    | 'apply_error'
    | 'sent'
    | 'send_failed';
};

/**
 * Обработка кнопок «⏳ Продлить»: та же изоляция через deps, ack — всегда.
 * Как и у ETA, ack идёт ПОСЛЕ применения: оператор должен сразу видеть,
 * дошло ли до клиента WhatsApp-сообщение о продлении.
 */
export async function handleDelayCallbackQuery(
  cbq: any,
  deps: DelayCallbackDeps
): Promise<DelayCallbackResult> {
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

  const parsed = parseDelayCallback(cbq?.data);
  if (!parsed) {
    await ack();
    return { handled: false, reason: 'not_delay_callback' };
  }

  const messageId: number | undefined = cbq?.message?.message_id;
  const swapKeyboard = async (
    fn: DelayCallbackDeps['showDelayMenu'] | DelayCallbackDeps['showMainKeyboard'],
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
    await swapKeyboard(deps.showDelayMenu, parsed.orderId, 'showDelayMenu');
    return { handled: true, reason: 'menu_shown' };
  }

  if (parsed.action === 'back') {
    await ack();
    await swapKeyboard(deps.showMainKeyboard, parsed.orderId, 'showMainKeyboard');
    return { handled: true, reason: 'menu_closed' };
  }

  const { minutes } = parsed;
  log('delay requested', { orderNumber: parsed.orderId, minutes });

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

  let result: { ok: boolean; etaMinutes?: number; whatsappSent: boolean };
  try {
    result = await deps.applyDelay(String(order._id ?? order.id), minutes);
  } catch (e) {
    log('applyDelay failed', (e as Error)?.message);
    result = { ok: false, whatsappSent: false };
  }

  if (!result.ok) {
    await ack({ text: 'Не удалось продлить заказ', show_alert: true });
    return { handled: false, minutes, reason: 'apply_error' };
  }

  const newEta = result.etaMinutes != null ? ` (теперь ~${result.etaMinutes} мин)` : '';
  await ack(
    result.whatsappSent
      ? { text: `⏳ +${minutes} мин${newEta} — клиенту отправлено` }
      : {
          text: `⏳ +${minutes} мин${newEta} — сохранено, но сообщение клиенту НЕ отправлено`,
          show_alert: true,
        }
  );

  if (messageId && deps.refreshMessage) {
    try {
      // Перечитываем заказ: applyDelay сохранял его в другом инстансе.
      const fresh = (await deps.findOrder(parsed.orderId).then(
        (o) => o,
        () => null
      )) || order;
      await deps.refreshMessage(messageId, fresh);
    } catch (e) {
      log('refreshMessage failed', (e as Error)?.message);
    }
  }

  return { handled: true, minutes, reason: result.whatsappSent ? 'sent' : 'send_failed' };
}

export interface StatusCallbackDeps {
  answerCallbackQuery: (id: string, opts?: { text?: string; show_alert?: boolean }) => PromiseLike<unknown>;
  findOrder: (orderNumber: string) => PromiseLike<any | null>;
  editMessage?: (messageId: number, status: OrderStatus, orderId: string, order: any) => Promise<void>;
  /**
   * Действие, результат которого оператор обязан увидеть в ответе на клик
   * (переезд карточки в тему статуса). Выполняется ДО answerCallbackQuery,
   * потому что ответить на callback_query можно ровно один раз: сообщи мы об
   * успехе заранее — про неудавшийся перенос оператор бы не узнал.
   */
  beforeAck?: (order: any, status: OrderStatus) => Promise<{ ok: boolean; error?: string } | void>;
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

  // Единственное действие ПЕРЕД ack: то, о результате которого нужно доложить
  // оператору (перенос карточки в тему статуса). Всё best-effort — после.
  let ackText = `Статус заказа #${parsed.orderId} → ${status}`;
  let ackAlert = false;
  if (deps.beforeAck) {
    try {
      const result = await deps.beforeAck(order, status);
      if (result && !result.ok) {
        ackText = result.error || 'Не удалось обновить статус, попробуйте ещё раз';
        ackAlert = true;
      }
    } catch (e) {
      log('beforeAck failed', (e as Error)?.message);
      ackText = 'Не удалось обновить статус, попробуйте ещё раз';
      ackAlert = true;
    }
  }

  // Подтверждаем клик (снимаем loading), дальше — best-effort side-effects.
  await ack({ text: ackText, show_alert: ackAlert });

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

// ---------------------------------------------------------------------------
// Кнопки карточки форума: «Назначить курьера» и «Проблема с доставкой»
// (переходы статуса по-прежнему идут через status_* — за ними вся доменная
// логика: сохранение заказа, баллы, WhatsApp клиенту)
// ---------------------------------------------------------------------------

export interface CardCallbackDeps {
  answerCallbackQuery: (id: string, opts?: { text?: string; show_alert?: boolean }) => PromiseLike<unknown>;
  /** Ростер курьеров из настроек (может быть пустым). */
  couriers: string[];
  /** Имя нажавшего — для кнопки «Я забираю». */
  clickerName: string;
  showCourierMenu: (orderNumber: string) => Promise<unknown>;
  showProblemMenu: (orderNumber: string) => Promise<unknown>;
  /** Вернуть обычную клавиатуру карточки. */
  restoreKeyboard: (orderNumber: string) => Promise<unknown>;
  assignCourier: (orderNumber: string, courier: string) => Promise<boolean>;
  reportProblem: (orderNumber: string, code: string) => Promise<boolean>;
  /** Перерисовать карточку (курьер/проблема появляются в тексте). */
  refreshCard: (orderNumber: string) => Promise<unknown>;
  log?: (...args: any[]) => void;
}

export type CardCallbackResult = {
  handled: boolean;
  reason:
    | 'not_card_callback'
    | 'courier_menu'
    | 'problem_menu'
    | 'closed'
    | 'courier_set'
    | 'problem_set'
    | 'card_not_found'
    | 'unknown_courier';
};

export async function handleCardCallbackQuery(
  cbq: any,
  deps: CardCallbackDeps
): Promise<CardCallbackResult> {
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

  const parsed = parseCardCallback(cbq?.data);
  if (!parsed) {
    await ack();
    return { handled: false, reason: 'not_card_callback' };
  }

  const safely = async (fn: () => Promise<unknown>, label: string) => {
    try {
      await fn();
    } catch (e) {
      log(`${label} failed`, (e as Error)?.message);
    }
  };

  if (parsed.action === 'courier_menu') {
    await ack();
    await safely(() => deps.showCourierMenu(parsed.orderNumber), 'showCourierMenu');
    return { handled: true, reason: 'courier_menu' };
  }

  if (parsed.action === 'problem_menu') {
    await ack();
    await safely(() => deps.showProblemMenu(parsed.orderNumber), 'showProblemMenu');
    return { handled: true, reason: 'problem_menu' };
  }

  if (parsed.action === 'back') {
    await ack();
    await safely(() => deps.restoreKeyboard(parsed.orderNumber), 'restoreKeyboard');
    return { handled: true, reason: 'closed' };
  }

  if (parsed.action === 'courier_set') {
    // 'me' — забирает тот, кто нажал; иначе индекс в ростере из настроек.
    const courier =
      parsed.value === 'me'
        ? deps.clickerName
        : deps.couriers[Number(parsed.value)] ?? '';
    if (!courier) {
      await ack({ text: 'Курьер не найден в списке', show_alert: true });
      return { handled: false, reason: 'unknown_courier' };
    }

    const ok = await deps
      .assignCourier(parsed.orderNumber, courier)
      .catch((e) => {
        log('assignCourier failed', (e as Error)?.message);
        return false;
      });
    if (!ok) {
      await ack({ text: 'Карточка заказа не найдена', show_alert: true });
      return { handled: false, reason: 'card_not_found' };
    }

    await ack({ text: `🧍 Курьер: ${courier}` });
    await safely(() => deps.refreshCard(parsed.orderNumber), 'refreshCard');
    return { handled: true, reason: 'courier_set' };
  }

  // parsed.action === 'problem_set'
  const ok = await deps.reportProblem(parsed.orderNumber, parsed.value).catch((e) => {
    log('reportProblem failed', (e as Error)?.message);
    return false;
  });
  if (!ok) {
    await ack({ text: 'Карточка заказа не найдена', show_alert: true });
    return { handled: false, reason: 'card_not_found' };
  }

  await ack({ text: `⚠️ Отмечено: ${problemLabel(parsed.value)}` });
  await safely(() => deps.refreshCard(parsed.orderNumber), 'refreshCard');
  return { handled: true, reason: 'problem_set' };
}

/** Имя нажавшего кнопку — для «Я забираю». */
function telegramUserName(from: any): string {
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(' ').trim();
  return name || from?.username || 'курьер';
}

/**
 * Обработка webhook-обновления от Telegram. Вызывается из API-роута.
 */
export async function processTelegramUpdate(update: any): Promise<void> {
  if (!update?.callback_query) return;

  const { bot, chatId } = await getTelegramConfig();
  await connectToDatabase();

  // Режим форума читаем ОДИН раз на апдейт: он определяет, чем является
  // «основная клавиатура» и куда возвращаться из подменю ETA/продления.
  const forum = await getForumConfig();

  /** Вернуть основную клавиатуру: карточка форума либо старое сообщение. */
  const showMainKeyboard = async (messageId: number, orderNumber: string) => {
    if (forum && (await setCardKeyboard(orderNumber, null, { config: forum }))) return;
    await bot.editMessageReplyMarkup(buildStatusKeyboard(orderNumber), {
      chat_id: chatId,
      message_id: messageId,
    });
  };

  /** Перерисовать сообщение заказа из свежих данных (ETA, продление). */
  const refreshOrderMessage = async (messageId: number, order: any) => {
    if (forum && (await refreshOrderCard(toCardOrderInput(order), { config: forum }))) return;
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
  };

  // Кнопки самой карточки (курьер / проблема с доставкой) — только в форуме.
  if (forum && parseCardCallback(update.callback_query?.data)) {
    await handleCardCallbackQuery(update.callback_query, {
      answerCallbackQuery: (cbId, opts) => bot.answerCallbackQuery(cbId, opts),
      couriers: forum.couriers,
      clickerName: telegramUserName(update.callback_query?.from),
      showCourierMenu: (orderNumber) =>
        setCardKeyboard(orderNumber, renderCourierKeyboard(orderNumber, forum.couriers), {
          config: forum,
        }),
      showProblemMenu: (orderNumber) =>
        setCardKeyboard(orderNumber, renderProblemKeyboard(orderNumber), { config: forum }),
      restoreKeyboard: (orderNumber) => setCardKeyboard(orderNumber, null, { config: forum }),
      assignCourier: async (orderNumber, courier) =>
        Boolean(await assignCardCourier(orderNumber, courier, { config: forum })),
      reportProblem: async (orderNumber, code) =>
        Boolean(await recordDeliveryProblem(orderNumber, code, { config: forum })),
      refreshCard: async (orderNumber) => {
        const order = await Order.findOne({ orderNumber });
        if (order) await refreshOrderCard(toCardOrderInput(order), { config: forum });
      },
    });
    return;
  }

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
      showMainKeyboard,
      // Пересобираем текст, чтобы в сообщении осталось «Клиенту сообщено».
      // Заодно возвращается основная клавиатура.
      refreshMessage: refreshOrderMessage,
      notifyCustomer: (order, minutes) =>
        sendOrderEtaNotification(
          { phoneNumber: order.phoneNumber, orderNumber: order.orderNumber },
          minutes
        ),
    });
    return;
  }

  if (parseDelayCallback(update.callback_query?.data)) {
    await handleDelayCallbackQuery(update.callback_query, {
      answerCallbackQuery: (cbId, opts) => bot.answerCallbackQuery(cbId, opts),
      findOrder: (orderNumber) => Order.findOne({ orderNumber }),
      applyDelay: (orderDbId, minutes) => applyOrderDelay(orderDbId, minutes),
      showDelayMenu: async (messageId, orderId) => {
        await bot.editMessageReplyMarkup(buildDelayKeyboard(orderId), {
          chat_id: chatId,
          message_id: messageId,
        });
      },
      showMainKeyboard,
      // Обновляем «Клиенту сообщено: ~N мин» и возвращаем основную клавиатуру.
      refreshMessage: refreshOrderMessage,
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

  // Откат ошибочного нажатия («Вернуть в путь») живёт ограниченное время, а
  // кнопка может провисеть дольше — проверяем срок ДО записи статуса заказа.
  const statusCallback = parseStatusCallback(update.callback_query?.data);
  if (forum && statusCallback) {
    const undo = await checkUndoWindow(statusCallback.orderId, { config: forum });
    if (!undo.allowed) {
      await bot
        .answerCallbackQuery(update.callback_query.id, { text: undo.message, show_alert: true })
        .catch((e: any) => console.error('answerCallbackQuery failed:', e?.message));
      // Убираем протухшую кнопку с карточки, чтобы её не жали снова.
      await setCardKeyboard(statusCallback.orderId, null, { config: forum }).catch(() => {});
      return;
    }
  }

  await handleStatusCallbackQuery(update.callback_query, {
    answerCallbackQuery: (cbId, opts) => bot.answerCallbackQuery(cbId, opts),
    findOrder: (orderNumber) => Order.findOne({ orderNumber }),
    // В форуме смена статуса — это ПЕРЕЕЗД карточки в тему статуса. Делаем его
    // до ответа на клик: не уехавшая карточка обязана всплыть оператору,
    // а ответить на callback_query можно только один раз.
    beforeAck: forum
      ? async (order, status) => {
          const target = cardStatusForOrderStatus(status);
          if (!target) return { ok: true };
          const result = await moveOrderCard(toCardOrderInput(order), target, { config: forum });
          if (result.ok) return { ok: true };
          return {
            ok: false,
            error:
              result.reason === 'raced'
                ? 'Карточку одновременно двигал кто-то ещё — проверьте темы'
                : 'Не удалось обновить статус, попробуйте ещё раз',
          };
        }
      : undefined,
    editMessage: forum
      ? undefined
      : async (messageId, status, orderId, order) => {
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
        {
          phoneNumber: order.phoneNumber,
          orderNumber: order.orderNumber,
          // От типа заказа зависит подпись статуса гостю: «Unterwegs» у
          // доставки и «Abholbereit» у самовывоза.
          deliveryType: order.deliveryType,
        },
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
        { text: '⏱ Время готовности', callback_data: `eta_menu_${orderId}` },
        // Продлить: +N мин к обещанию + WhatsApp о задержке (lib/orders/delay.ts).
        { text: '⏳ Продлить', callback_data: `delay_menu_${orderId}` }
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

/** Пресеты «+N мин» кнопки «⏳ Продлить» (тот же список, что в панели плана). */
function buildDelayKeyboard(orderId: string) {
  return {
    inline_keyboard: [
      ORDER_DELAY_CHOICES.map((m) => ({
        text: `+${m} мин`,
        callback_data: `delay_set_${m}_${orderId}`
      })),
      [{ text: '◀️ Назад', callback_data: `delay_back_${orderId}` }]
    ]
  };
}
