/**
 * Бот-диспетчер кухни — ОТДЕЛЬНЫЙ Telegram-бот (третий: заказы / stop / план).
 *
 * Умеет:
 *   - /plan (и кнопка «Пересчитать») — тот же AI-план кухни, что панель в
 *     админке (lib/eta/kitchen-plan.ts): что готовить, в каком порядке и какие
 *     доставки объединять в рейсы. Анализируются ОБА канала: заказы сайта и
 *     чеки Lieferando.
 *   - 📸 фото или PDF чека Lieferando → Claude Vision распознаёт чек и создаёт заказ
 *     source='lieferando' (lib/lieferando/receipt-import.ts) — он попадает в
 *     план наравне с заказами сайта.
 *   - ⏰ кнопки «#N +10/+15/+20/+30 мин» под планом для опаздывающих заказов —
 *     сдвигают обещание и шлют гостю WhatsApp о задержке на немецком через
 *     Twilio (lib/orders/delay.ts).
 *
 * Отдельный токен/секрет/чат: storeSettings.telegramPlanBotToken /
 * telegramPlanChatId / telegramPlanWebhookSecret, фолбэк — env
 * TELEGRAM_PLAN_BOT_TOKEN / TELEGRAM_PLAN_CHAT_ID / TELEGRAM_PLAN_WEBHOOK_SECRET.
 * Как и stop-бот — прямой fetch к Bot API, без node-telegram-bot-api.
 */

import { getSetting } from './settings';
import { buildKitchenPlan } from './eta/kitchen-plan';
import type { KitchenPlan } from './eta/types';
import {
  parseLieferandoReceipt,
  importLieferandoReceipt,
  type ReceiptImage,
  type ReceiptImageMediaType,
  type ReceiptImportResult,
} from './lieferando/receipt-import';
import { applyOrderDelay, ORDER_DELAY_CHOICES, type OrderDelayResult } from './orders/delay';

const STORE_SETTINGS_KEY = 'storeSettings';
const TZ = 'Europe/Berlin';

/** callback_data кнопок (префикс plan_ — не пересекается с status_/eta_/ctrl_). */
export const PLAN_REFRESH = 'plan_refresh';
/** «Заказ опаздывает»: plan_delay_<orderId>_<минуты>. */
export const PLAN_DELAY_PREFIX = 'plan_delay_';

export interface PlanBotConfig {
  botToken: string;
  /** id чата персонала; команды и колбэки принимаются только отсюда. */
  chatId: string;
  webhookSecret: string;
}

export async function getPlanBotConfig(): Promise<PlanBotConfig> {
  const s = (await getSetting<Record<string, any>>(STORE_SETTINGS_KEY, {})) || {};
  return {
    botToken: s.telegramPlanBotToken || process.env.TELEGRAM_PLAN_BOT_TOKEN || '',
    chatId: String(s.telegramPlanChatId || process.env.TELEGRAM_PLAN_CHAT_ID || ''),
    webhookSecret: s.telegramPlanWebhookSecret || process.env.TELEGRAM_PLAN_WEBHOOK_SECRET || '',
  };
}

// --- парсинг входящего ----------------------------------------------------

/** Текст сообщения → команда бота (учитывает /plan@botname). */
export function parsePlanCommand(text: unknown): 'plan' | 'help' | null {
  if (typeof text !== 'string') return null;
  const first = text.trim().split(/\s+/)[0]?.split('@')[0]?.toLowerCase();
  if (first === '/plan') return 'plan';
  if (first === '/start' || first === '/help') return 'help';
  return null;
}

function isAllowedChat(chatId: unknown, allowed: string): boolean {
  // Пустой allowed = не настроен → безопаснее отклонять всё.
  if (!allowed) return false;
  return String(chatId) === String(allowed);
}

// --- рендер плана в HTML-сообщение -----------------------------------------

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const LOAD_LABEL: Record<string, string> = {
  normal: '🟢 нагрузка: норма',
  busy: '🟡 нагрузка: плотно',
  peak: '🔴 нагрузка: ПИК',
};

/** Тот же контент, что панель админки, — в формате Telegram-сообщения. */
export function buildPlanMessageText(plan: KitchenPlan, timeZone = TZ): string {
  const time = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(plan.generatedAt));

  const lines: string[] = [
    `👨‍🍳 <b>AI-план кухни</b> · ${LOAD_LABEL[plan.loadLevel] ?? plan.loadLevel} · ${
      plan.source === 'ai' ? 'Claude' : 'эвристика'
    } ${time}`,
  ];

  if (plan.batches.length === 0) {
    lines.push('', 'Активных заказов нет — планировать нечего.');
  } else {
    if (plan.summary) lines.push('', escapeHtml(plan.summary));
    for (const b of plan.batches) {
      const orders = b.orderNumbers.map((n) => `#${n}`).join(' + ');
      const together = b.cookTogether ? ' · 🍳 готовить вместе' : '';
      lines.push('', `<b>${b.step}. ${escapeHtml(orders)}</b> — ${escapeHtml(b.area)}${together}`);
      if (b.courier) lines.push(`🚴 ${escapeHtml(b.courier)}`);
      if (b.rationale) lines.push(`💬 ${escapeHtml(b.rationale)}`);
    }
  }

  if (plan.onTheRoad.length > 0) {
    lines.push('', `🚚 Уже в пути: ${plan.onTheRoad.map((n) => `#${n}`).join(', ')}`);
  }

  const late = plan.lateOrders ?? [];
  if (late.length > 0) {
    lines.push('', '⏰ <b>Опаздывают:</b>');
    for (const lo of late) {
      const src = lo.source === 'lieferando' ? 'Lieferando' : 'сайт';
      const state = lo.minutesLate > 0 ? `просрочка ${lo.minutesLate} мин` : 'впритык к обещанию';
      const phone = lo.hasPhone ? '' : ' · нет телефона гостя';
      lines.push(`#${escapeHtml(lo.orderNumber)} (${src}) — ${state}${phone}`);
    }
    if (late.some((lo) => lo.hasPhone && lo.orderId)) {
      lines.push('Кнопки ниже сдвинут обещание и отправят гостю WhatsApp о задержке (на немецком).');
    }
  }

  if (plan.advisory) {
    lines.push('', `⚠️ ${escapeHtml(plan.advisory)}`);
  }

  return lines.join('\n');
}

export type TgInlineKeyboard = {
  inline_keyboard: { text: string; callback_data: string }[][];
};

/**
 * Клавиатура под планом: «Пересчитать» + по строке кнопок задержки на каждый
 * опаздывающий заказ (только если есть id и телефон гостя — иначе слать нечего/некому).
 */
export function buildPlanKeyboard(plan?: KitchenPlan | null): TgInlineKeyboard {
  const rows: TgInlineKeyboard['inline_keyboard'] = [
    [{ text: '🔄 Пересчитать план', callback_data: PLAN_REFRESH }],
  ];
  for (const late of plan?.lateOrders ?? []) {
    if (!late.orderId || !late.hasPhone) continue;
    rows.push(
      ORDER_DELAY_CHOICES.map((minutes, i) => ({
        text: i === 0 ? `⏰ #${late.orderNumber} +${minutes} мин` : `+${minutes} мин`,
        callback_data: `${PLAN_DELAY_PREFIX}${late.orderId}_${minutes}`,
      }))
    );
  }
  return { inline_keyboard: rows };
}

const HELP_TEXT = [
  '👨‍🍳 <b>Бот-диспетчер Dumbos Pizza</b>',
  '',
  '/plan — AI-план кухни по ВСЕМ заказам (сайт + Lieferando): что готовить, в каком порядке, какие доставки объединить в рейс (то же, что панель в админке).',
  '',
  '📸 Пришлите фото или PDF чека Lieferando — заказ будет распознан и добавлен в план.',
  '',
  '⏰ Если заказ опаздывает, под планом появятся кнопки «+10/+15/+20/+30 мин» — гость получит WhatsApp о задержке на немецком.',
].join('\n');

// --- приём чеков Lieferando ---------------------------------------------------

/** Формат денег для ответа персоналу: 12,50 €. */
function formatEuro(value: number): string {
  return `${value.toFixed(2).replace('.', ',')} €`;
}

/**
 * Фото/документ из чата → распознать чек Lieferando и создать заказ в плане.
 * Скачивание+распознавание инжектится через deps.importReceipt (тестируется без сети).
 */
export async function handleReceiptUpload(message: any, deps: PlanBotDeps): Promise<PlanBotResult> {
  const chatId = message.chat.id;
  const photo = Array.isArray(message?.photo) ? message.photo[message.photo.length - 1] : null;
  const document = message?.document ?? null;

  let fileId: string | undefined = photo?.file_id;
  if (!fileId && document?.file_id) {
    // Портал Lieferando отдаёт чек как receipt-XXXX.pdf — принимаем и его.
    const mime = String(document.mime_type || '');
    if (!mime.startsWith('image/') && mime !== 'application/pdf') {
      await deps.sendMessage(
        chatId,
        '📄 Такой файл не распознать — пришлите чек Lieferando как фото (JPG/PNG) или PDF.'
      );
      return { handled: true, reason: 'receipt_rejected' };
    }
    fileId = document.file_id;
  }
  if (!fileId) {
    await deps.sendMessage(chatId, '🤔 Не вижу файла — пришлите фото чека Lieferando.');
    return { handled: true, reason: 'receipt_rejected' };
  }

  deps.log?.('receipt upload received', { fileId, hasPhoto: !!photo, hasDocument: !!document });
  await deps.sendMessage(chatId, '🔍 Распознаю чек Lieferando…');

  let result: ReceiptImportResult;
  try {
    result = await deps.importReceipt(fileId);
  } catch (e) {
    deps.log?.('importReceipt failed', (e as Error)?.message);
    result = { ok: false, reason: 'error' };
  }

  if (result.ok && result.order) {
    const o = result.order;
    const lines = [
      `✅ Заказ <b>#${escapeHtml(result.orderNumber ?? '')}</b> добавлен в план`,
      `👤 ${escapeHtml(o.customerName)} · ${o.deliveryType === 'pickup' ? '🏃 самовывоз' : '🛵 доставка'}`,
    ];
    if (o.address) lines.push(`📍 ${escapeHtml(o.address)}`);
    lines.push(`🧾 ${o.itemsCount} поз. · ${formatEuro(o.total)}`);
    if (o.etaMinutes != null) lines.push(`⏱ обещание ~${o.etaMinutes} мин`);
    if (!o.hasPhone) {
      lines.push('📵 Телефона на чеке нет — WhatsApp о задержке будет недоступен.');
    }
    lines.push('', 'Нажмите «Пересчитать план», чтобы включить заказ в маршруты.');
    await deps.sendMessage(chatId, lines.join('\n'), buildPlanKeyboard());
    return { handled: true, reason: 'receipt_imported' };
  }

  if (result.reason === 'duplicate') {
    await deps.sendMessage(
      chatId,
      `♻️ Этот чек уже учтён — заказ <b>#${escapeHtml(result.orderNumber ?? '')}</b> есть в плане.`
    );
    return { handled: true, reason: 'receipt_duplicate' };
  }
  if (result.reason === 'not_receipt' || result.reason === 'no_items') {
    await deps.sendMessage(
      chatId,
      '🤔 Не похоже на чек Lieferando — заказ не создан. Пришлите фото самого чека (Bestellbon).'
    );
    return { handled: true, reason: 'receipt_rejected' };
  }

  await deps.sendMessage(
    chatId,
    '⚠️ Не удалось распознать чек — попробуйте ещё раз (фото чётче и ближе, без бликов).'
  );
  return { handled: true, reason: 'receipt_error' };
}

// --- ядро обработки (изолировано от Telegram/БД через deps — тестируется) ---

export interface PlanBotDeps {
  answerCallbackQuery: (id: string, text?: string) => PromiseLike<unknown>;
  sendMessage: (
    chatId: number | string,
    text: string,
    keyboard?: TgInlineKeyboard
  ) => PromiseLike<unknown>;
  editMessage: (
    chatId: number | string,
    messageId: number,
    text: string,
    keyboard?: TgInlineKeyboard
  ) => PromiseLike<unknown>;
  buildPlan: () => PromiseLike<KitchenPlan>;
  /** Скачать файл Telegram по file_id, распознать чек Lieferando и создать заказ. */
  importReceipt: (fileId: string) => PromiseLike<ReceiptImportResult>;
  /** «Заказ опаздывает на N минут»: сдвиг обещания + WhatsApp гостю. */
  applyDelay: (orderId: string, delayMinutes: number) => PromiseLike<OrderDelayResult>;
  allowedChatId: string;
  log?: (...args: any[]) => void;
}

export type PlanBotResult = {
  handled: boolean;
  reason:
    | 'plan_sent'
    | 'plan_refreshed'
    | 'help'
    | 'receipt_imported'
    | 'receipt_duplicate'
    | 'receipt_rejected'
    | 'receipt_error'
    | 'delay_applied'
    | 'delay_failed'
    | 'wrong_chat'
    | 'not_ours'
    | 'error';
};

export async function handlePlanUpdate(update: any, deps: PlanBotDeps): Promise<PlanBotResult> {
  const log = deps.log || ((...a: any[]) => console.log('[tg-plan]', ...a));

  // 1) Кнопка «Пересчитать план» — пересобираем и редактируем то же сообщение.
  if (update?.callback_query) {
    const cbq = update.callback_query;
    const id: string = cbq?.id;
    const chatId = cbq?.message?.chat?.id;

    const ack = async (text?: string) => {
      if (!id) return;
      try {
        await deps.answerCallbackQuery(id, text);
      } catch (e) {
        log('answerCallbackQuery failed', (e as Error)?.message);
      }
    };

    if (!isAllowedChat(chatId, deps.allowedChatId)) {
      log('callback from foreign chat', chatId);
      await ack('⛔️ Недостаточно прав');
      return { handled: false, reason: 'wrong_chat' };
    }

    const data: string = typeof cbq?.data === 'string' ? cbq.data : '';
    const messageId = cbq?.message?.message_id;

    /** Пересобрать план и отредактировать сообщение с кнопками (best-effort). */
    const refreshMessage = async () => {
      if (messageId == null) return;
      try {
        const plan = await deps.buildPlan();
        // «message is not modified» при неизменном плане — глотаем.
        await deps.editMessage(chatId, messageId, buildPlanMessageText(plan), buildPlanKeyboard(plan));
      } catch (e) {
        log('refresh message failed', (e as Error)?.message);
      }
    };

    // «Заказ опаздывает на N минут» — сдвиг обещания + WhatsApp гостю.
    const delayMatch = data.match(/^plan_delay_([A-Za-z0-9-]+)_(\d+)$/);
    if (delayMatch) {
      let result: OrderDelayResult;
      try {
        result = await deps.applyDelay(delayMatch[1], Number(delayMatch[2]));
      } catch (e) {
        log('applyDelay failed', (e as Error)?.message);
        result = { ok: false, reason: 'error', whatsappSent: false };
      }
      if (!result.ok) {
        await ack('⚠️ Не удалось применить задержку');
        return { handled: false, reason: 'delay_failed' };
      }
      await ack(
        `✅ #${result.orderNumber}: +${Number(delayMatch[2])} мин` +
          (result.whatsappSent ? ', гость получил WhatsApp' : ' (WhatsApp не отправлен)')
      );
      await refreshMessage();
      return { handled: true, reason: 'delay_applied' };
    }

    if (data !== PLAN_REFRESH) {
      await ack();
      return { handled: false, reason: 'not_ours' };
    }

    let plan: KitchenPlan;
    try {
      plan = await deps.buildPlan();
    } catch (e) {
      log('buildPlan failed', (e as Error)?.message);
      await ack('Не удалось построить план');
      return { handled: false, reason: 'error' };
    }

    await ack('🔄 План пересчитан');
    if (messageId != null) {
      try {
        // best-effort: «message is not modified» при неизменном плане — глотаем.
        await deps.editMessage(chatId, messageId, buildPlanMessageText(plan), buildPlanKeyboard(plan));
      } catch (e) {
        log('editMessage failed', (e as Error)?.message);
      }
    }
    return { handled: true, reason: 'plan_refreshed' };
  }

  // 2) Сообщения: команды и загрузка чеков.
  if (update?.message) {
    const msg = update.message;
    const chatId = msg?.chat?.id;

    if (!isAllowedChat(chatId, deps.allowedChatId)) {
      log('message from foreign chat', chatId);
      return { handled: false, reason: 'wrong_chat' };
    }

    // Фото/документ → распознавание чека Lieferando и создание заказа.
    if (msg?.photo || msg?.document) {
      try {
        return await handleReceiptUpload(msg, deps);
      } catch (e) {
        log('handleReceiptUpload failed', (e as Error)?.message);
        return { handled: true, reason: 'receipt_error' };
      }
    }

    const command = parsePlanCommand(msg?.text);
    if (!command) return { handled: false, reason: 'not_ours' };

    if (command === 'help') {
      try {
        await deps.sendMessage(chatId, HELP_TEXT);
      } catch (e) {
        log('sendMessage(help) failed', (e as Error)?.message);
      }
      return { handled: true, reason: 'help' };
    }

    // /plan
    let plan: KitchenPlan;
    try {
      plan = await deps.buildPlan();
    } catch (e) {
      log('buildPlan failed', (e as Error)?.message);
      try {
        await deps.sendMessage(chatId, '⚠️ Не удалось построить план — попробуйте ещё раз.');
      } catch {
        /* best-effort */
      }
      return { handled: false, reason: 'error' };
    }
    try {
      await deps.sendMessage(chatId, buildPlanMessageText(plan), buildPlanKeyboard(plan));
    } catch (e) {
      log('sendMessage(plan) failed', (e as Error)?.message);
      return { handled: false, reason: 'error' };
    }
    return { handled: true, reason: 'plan_sent' };
  }

  return { handled: false, reason: 'not_ours' };
}

// --- обёртка: живой Telegram Bot API ----------------------------------------

async function tgApi(token: string, method: string, body: Record<string, any>): Promise<any> {
  if (!token) throw new Error('Plan-Bot: токен не настроен');
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

/** media_type для Claude Vision по расширению file_path Telegram'а. */
function mediaTypeFromPath(filePath: string): ReceiptImageMediaType {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg'; // фото Telegram всегда пережимает в JPEG
}

/** Скачивает файл по file_id: getFile → https://api.telegram.org/file/bot<token>/<path>. */
async function downloadTelegramFile(token: string, fileId: string): Promise<ReceiptImage | null> {
  const info = await tgApi(token, 'getFile', { file_id: fileId });
  const filePath: string | undefined = info?.result?.file_path;
  if (!filePath) {
    console.error('[tg-plan] getFile failed:', JSON.stringify(info?.description ?? info));
    return null;
  }
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!res.ok) {
    console.error('[tg-plan] file download failed:', res.status);
    return null;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { base64: buf.toString('base64'), mediaType: mediaTypeFromPath(filePath) };
}

/** Точка входа из вебхука: собирает deps на живом Bot API и вызывает ядро. */
export async function processPlanUpdate(
  update: any,
  cfg?: PlanBotConfig
): Promise<PlanBotResult> {
  const config = cfg || (await getPlanBotConfig());
  const token = config.botToken;

  const deps: PlanBotDeps = {
    answerCallbackQuery: (cbId, text) =>
      tgApi(token, 'answerCallbackQuery', { callback_query_id: cbId, ...(text ? { text } : {}) }),
    sendMessage: (chatId, text, keyboard) =>
      tgApi(token, 'sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...(keyboard ? { reply_markup: keyboard } : {}),
      }),
    editMessage: (chatId, messageId, text, keyboard) =>
      tgApi(token, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        ...(keyboard ? { reply_markup: keyboard } : {}),
      }),
    buildPlan: () => buildKitchenPlan(),
    importReceipt: async (fileId) => {
      const image = await downloadTelegramFile(token, fileId);
      if (!image) return { ok: false, reason: 'error' };
      const parsed = await parseLieferandoReceipt(image);
      return importLieferandoReceipt(parsed);
    },
    applyDelay: (orderId, delayMinutes) => applyOrderDelay(orderId, delayMinutes),
    allowedChatId: config.chatId,
  };

  return handlePlanUpdate(update, deps);
}
