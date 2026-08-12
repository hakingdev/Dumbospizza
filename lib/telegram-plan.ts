/**
 * Бот-диспетчер кухни — ОТДЕЛЬНЫЙ Telegram-бот (третий: заказы / stop / план).
 *
 * Сегодня: команда /plan (и кнопка «Пересчитать») выдаёт тот же AI-план кухни,
 * что панель в админке (lib/eta/kitchen-plan.ts) — что готовить, в каком
 * порядке и какие доставки объединять в рейсы. Заказы сайта берутся из БД
 * (активная очередь), персонал/курьеры — из настроек панели.
 *
 * ✏️  ЗАДЕЛ НА БУДУЩЕЕ — ЧЕКИ LIEFERANDO:
 * бот принимает фото/документы уже сейчас; обработчик handleReceiptUpload()
 * пока заглушка. Когда займёмся распознаванием: скачать файл по file_id
 * (getFile → https://api.telegram.org/file/bot<token>/<file_path>), прогнать
 * через Claude vision и добавить заказ в очередь плана как источник
 * "lieferando". Точка входа одна — расширять только handleReceiptUpload.
 *
 * Отдельный токен/секрет/чат: storeSettings.telegramPlanBotToken /
 * telegramPlanChatId / telegramPlanWebhookSecret, фолбэк — env
 * TELEGRAM_PLAN_BOT_TOKEN / TELEGRAM_PLAN_CHAT_ID / TELEGRAM_PLAN_WEBHOOK_SECRET.
 * Как и stop-бот — прямой fetch к Bot API, без node-telegram-bot-api.
 */

import { getSetting } from './settings';
import { buildKitchenPlan } from './eta/kitchen-plan';
import type { KitchenPlan } from './eta/types';

const STORE_SETTINGS_KEY = 'storeSettings';
const TZ = 'Europe/Berlin';

/** callback_data кнопки (префикс plan_ — не пересекается с status_/eta_/ctrl_). */
export const PLAN_REFRESH = 'plan_refresh';

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
  if (plan.advisory) {
    lines.push('', `⚠️ ${escapeHtml(plan.advisory)}`);
  }

  return lines.join('\n');
}

export function buildPlanKeyboard() {
  return {
    inline_keyboard: [[{ text: '🔄 Пересчитать план', callback_data: PLAN_REFRESH }]],
  };
}

const HELP_TEXT = [
  '👨‍🍳 <b>Бот-диспетчер Dumbos Pizza</b>',
  '',
  '/plan — AI-план кухни: что готовить, в каком порядке, какие доставки объединить в рейс (то же, что панель в админке).',
  '',
  '📸 Чеки Lieferando: пришлите фото чека — учёт в плане в разработке.',
].join('\n');

// --- заглушка приёма чеков Lieferando ---------------------------------------

/**
 * ✏️ ТОЧКА РАСШИРЕНИЯ: сюда придёт каждое фото/документ из чата.
 * Сейчас — только подтверждение приёма. Дальше: getFile по file_id, скачать,
 * распознать Claude'ом, добавить заказ в план как источник "lieferando".
 */
export async function handleReceiptUpload(
  message: any,
  deps: PlanBotDeps
): Promise<void> {
  const photo = Array.isArray(message?.photo) ? message.photo[message.photo.length - 1] : null;
  const document = message?.document ?? null;
  const fileId: string | undefined = photo?.file_id || document?.file_id;
  deps.log?.('receipt upload received', { fileId, hasPhoto: !!photo, hasDocument: !!document });

  await deps.sendMessage(
    message.chat.id,
    '📸 Чек получен. Распознавание чеков Lieferando ещё в разработке — пока учитываю только заказы сайта. /plan — текущий план.'
  );
}

// --- ядро обработки (изолировано от Telegram/БД через deps — тестируется) ---

export interface PlanBotDeps {
  answerCallbackQuery: (id: string, text?: string) => PromiseLike<unknown>;
  sendMessage: (chatId: number | string, text: string, withKeyboard?: boolean) => PromiseLike<unknown>;
  editMessage: (chatId: number | string, messageId: number, text: string) => PromiseLike<unknown>;
  buildPlan: () => PromiseLike<KitchenPlan>;
  allowedChatId: string;
  log?: (...args: any[]) => void;
}

export type PlanBotResult = {
  handled: boolean;
  reason:
    | 'plan_sent'
    | 'plan_refreshed'
    | 'help'
    | 'receipt_stub'
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
    if (cbq?.data !== PLAN_REFRESH) {
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
    const messageId = cbq?.message?.message_id;
    if (messageId != null) {
      try {
        // best-effort: «message is not modified» при неизменном плане — глотаем.
        await deps.editMessage(chatId, messageId, buildPlanMessageText(plan));
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

    // Фото/документ → приём чека Lieferando (пока заглушка).
    if (msg?.photo || msg?.document) {
      try {
        await handleReceiptUpload(msg, deps);
      } catch (e) {
        log('handleReceiptUpload failed', (e as Error)?.message);
      }
      return { handled: true, reason: 'receipt_stub' };
    }

    const command = parsePlanCommand(msg?.text);
    if (!command) return { handled: false, reason: 'not_ours' };

    if (command === 'help') {
      try {
        await deps.sendMessage(chatId, HELP_TEXT, false);
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
        await deps.sendMessage(chatId, '⚠️ Не удалось построить план — попробуйте ещё раз.', false);
      } catch {
        /* best-effort */
      }
      return { handled: false, reason: 'error' };
    }
    try {
      await deps.sendMessage(chatId, buildPlanMessageText(plan), true);
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
    sendMessage: (chatId, text, withKeyboard = true) =>
      tgApi(token, 'sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...(withKeyboard ? { reply_markup: buildPlanKeyboard() } : {}),
      }),
    editMessage: (chatId, messageId, text) =>
      tgApi(token, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        reply_markup: buildPlanKeyboard(),
      }),
    buildPlan: () => buildKitchenPlan(),
    allowedChatId: config.chatId,
  };

  return handlePlanUpdate(update, deps);
}
