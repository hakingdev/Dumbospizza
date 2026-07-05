/**
 * Stop-бот приёма заказов — ОТДЕЛЬНЫЙ Telegram-бот в служебной группе.
 *
 * Задача узкая: заблокировать/разблокировать приём заказов на 30/60 минут.
 * Ничего в логике приёма НЕ дублирует — пишет в тот же единый источник правды
 * `storeSettings.ordersBlockedUntil` (ISO-таймстамп), который уже уважают:
 *   - сервер:  app/api/orders/route.ts       (403, если blockedUntil > now)
 *   - сайт:    app/(main)/checkout/page.tsx  (баннер «кухня загружена»)
 *   - мобилка: app/api/mobile/v1/bootstrap
 *   - админка: app/admin/settings/page.tsx   (та же запись now+minutes)
 *
 * Отдельный токен/секрет/чат от бота статусов заказов (lib/telegram.ts).
 * Работает через прямой fetch к Bot API — без node-telegram-bot-api и без
 * общего botCache, чтобы не трогать код бота заказов.
 *
 * Язык панели — русский (как внутренний бот заказов и админка), НЕ немецкий:
 * это служебный интерфейс персонала, а не клиентское сообщение.
 */
import { getSetting, setSetting } from './settings';

const STORE_SETTINGS_KEY = 'storeSettings';
const TZ = 'Europe/Berlin';

// callback_data кнопок панели (префикс ctrl_ — не пересекается со status_ бота заказов)
export const CTRL_BLOCK_30 = 'ctrl_block_30';
export const CTRL_BLOCK_60 = 'ctrl_block_60';
export const CTRL_UNBLOCK = 'ctrl_unblock';
export const CTRL_STATUS = 'ctrl_status';

export interface ControlConfig {
  botToken: string;
  /** id служебной группы; колбэки принимаются только отсюда */
  chatId: string;
  webhookSecret: string;
}

export type ControlAction =
  | { type: 'block'; minutes: number }
  | { type: 'unblock' }
  | { type: 'status' };

export type ControlResult = {
  handled: boolean;
  reason: 'blocked' | 'unblocked' | 'status' | 'panel' | 'wrong_chat' | 'not_ours' | 'error';
};

// --- конфиг: storeSettings, фолбэк на env (как у бота заказов) ----------------

export async function getControlConfig(): Promise<ControlConfig> {
  const s = (await getSetting<Record<string, any>>(STORE_SETTINGS_KEY, {})) || {};
  return {
    botToken: s.telegramControlBotToken || process.env.TELEGRAM_CONTROL_BOT_TOKEN || '',
    chatId: String(s.telegramControlChatId || process.env.TELEGRAM_CONTROL_CHAT_ID || ''),
    webhookSecret:
      s.telegramControlWebhookSecret || process.env.TELEGRAM_CONTROL_WEBHOOK_SECRET || '',
  };
}

// --- парсинг входящего ---------------------------------------------------------

/** callback_data → действие, либо null если кнопка не наша. */
export function parseControlAction(data: unknown): ControlAction | null {
  switch (data) {
    case CTRL_BLOCK_30:
      return { type: 'block', minutes: 30 };
    case CTRL_BLOCK_60:
      return { type: 'block', minutes: 60 };
    case CTRL_UNBLOCK:
      return { type: 'unblock' };
    case CTRL_STATUS:
      return { type: 'status' };
    default:
      return null;
  }
}

/** Текст сообщения → команда панели (/panel, /start, в т.ч. /panel@bot). */
export function parseCommand(text: unknown): 'panel' | null {
  if (typeof text !== 'string') return null;
  const first = text.trim().split(/\s+/)[0]?.split('@')[0]?.toLowerCase();
  return first === '/panel' || first === '/start' ? 'panel' : null;
}

function isAllowedChat(chatId: unknown, allowed: string): boolean {
  // Пустой allowed = не настроен → безопаснее отклонять всё.
  if (!allowed) return false;
  return String(chatId) === String(allowed);
}

// --- запись состояния блокировки (read-modify-write) ---------------------------

/**
 * Применяет действие к storeSettings, меняя ТОЛЬКО ordersBlockedUntil.
 * read-modify-write обязателен: setSetting перезаписывает объект целиком, иначе
 * затрём остальные настройки магазина. Для 'status' ничего не пишет.
 * Возвращает актуальное значение ordersBlockedUntil ('' = приём открыт).
 */
export async function applyBlockAction(
  action: ControlAction,
  now: Date = new Date()
): Promise<string> {
  const current = (await getSetting<Record<string, any>>(STORE_SETTINGS_KEY, {})) || {};
  if (action.type === 'status') {
    return current.ordersBlockedUntil || '';
  }
  const ordersBlockedUntil =
    action.type === 'block'
      ? new Date(now.getTime() + action.minutes * 60_000).toISOString()
      : '';
  await setSetting(STORE_SETTINGS_KEY, { ...current, ordersBlockedUntil });
  return ordersBlockedUntil;
}

// --- рендер панели -------------------------------------------------------------

function formatTime(d: Date, timeZone = TZ): string {
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(d);
}

export function buildControlKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🔴 Блок 30 мин', callback_data: CTRL_BLOCK_30 },
        { text: '🔴 Блок 60 мин', callback_data: CTRL_BLOCK_60 },
      ],
      [
        { text: '🟢 Разблокировать', callback_data: CTRL_UNBLOCK },
        { text: '🔄 Статус', callback_data: CTRL_STATUS },
      ],
    ],
  };
}

/** Текст панели по текущему ordersBlockedUntil. Снимок на момент рендера. */
export function buildPanelText(
  ordersBlockedUntil: string,
  now: Date = new Date(),
  timeZone = TZ
): string {
  const until = ordersBlockedUntil ? new Date(ordersBlockedUntil) : null;
  const active = !!until && until.getTime() > now.getTime();
  const header = '🛑 <b>Управление приёмом заказов</b>';
  if (active) {
    return `${header}\n\n🔴 <b>ПРИЁМ ЗАБЛОКИРОВАН</b> до ${formatTime(until!, timeZone)}\nНовые заказы отклоняются.`;
  }
  return `${header}\n\n🟢 <b>ПРИЁМ АКТИВЕН</b>\nЗаказы принимаются.`;
}

/** Короткий toast для answerCallbackQuery. */
function toastFor(action: ControlAction, until: string, now: Date = new Date()): string {
  if (action.type === 'block' && until) return `⛔️ Блок до ${formatTime(new Date(until))}`;
  if (action.type === 'unblock') return '✅ Приём открыт';
  const active = !!until && new Date(until).getTime() > now.getTime();
  return active ? `🔴 Блок до ${formatTime(new Date(until))}` : '🟢 Приём активен';
}

// --- ядро обработки (изолировано от Telegram/БД через deps — тестируется) ------

export interface ControlDeps {
  answerCallbackQuery: (id: string, text?: string) => PromiseLike<unknown>;
  editPanel: (chatId: number | string, messageId: number, text: string) => PromiseLike<unknown>;
  sendPanel: (chatId: number | string, text: string) => PromiseLike<unknown>;
  getBlockState: () => PromiseLike<Record<string, any>>;
  applyAction: (action: ControlAction, now?: Date) => PromiseLike<string>;
  allowedChatId: string;
  log?: (...args: any[]) => void;
}

export async function handleControlUpdate(
  update: any,
  deps: ControlDeps
): Promise<ControlResult> {
  const log = deps.log || ((...a: any[]) => console.log('[tg-control]', ...a));

  // 1) Нажатие кнопки панели
  if (update?.callback_query) {
    const cbq = update.callback_query;
    const id: string = cbq?.id;
    const chatId = cbq?.message?.chat?.id;

    // answerCallbackQuery не должен ронять обработку (иначе вечный loading).
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

    const action = parseControlAction(cbq?.data);
    if (!action) {
      await ack();
      return { handled: false, reason: 'not_ours' };
    }

    let until: string;
    try {
      until = await deps.applyAction(action);
    } catch (e) {
      log('applyAction failed', (e as Error)?.message);
      await ack('Ошибка сохранения');
      return { handled: false, reason: 'error' };
    }

    await ack(toastFor(action, until));

    const messageId = cbq?.message?.message_id;
    if (messageId != null) {
      try {
        // best-effort: editMessageText кидает «message is not modified», если
        // текст не изменился (напр. повторный Статус) — глотаем.
        await deps.editPanel(chatId, messageId, buildPanelText(until));
      } catch (e) {
        log('editPanel failed', (e as Error)?.message);
      }
    }

    const reason =
      action.type === 'block' ? 'blocked' : action.type === 'unblock' ? 'unblocked' : 'status';
    return { handled: true, reason };
  }

  // 2) Команда /panel | /start — публикуем свежую панель
  if (update?.message) {
    const msg = update.message;
    if (parseCommand(msg?.text) !== 'panel') {
      return { handled: false, reason: 'not_ours' };
    }
    const chatId = msg?.chat?.id;
    if (!isAllowedChat(chatId, deps.allowedChatId)) {
      log('command from foreign chat', chatId);
      return { handled: false, reason: 'wrong_chat' };
    }
    const state = await deps.getBlockState();
    const until = state?.ordersBlockedUntil || '';
    try {
      await deps.sendPanel(chatId, buildPanelText(until));
    } catch (e) {
      log('sendPanel failed', (e as Error)?.message);
    }
    return { handled: true, reason: 'panel' };
  }

  return { handled: false, reason: 'not_ours' };
}

// --- обёртка: живой Telegram Bot API + storeSettings --------------------------

async function tgApi(token: string, method: string, body: Record<string, any>): Promise<any> {
  if (!token) throw new Error('Control-Bot: токен не настроен');
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

/** Точка входа из вебхука: собирает deps на живом Bot API и вызывает ядро. */
export async function processControlUpdate(
  update: any,
  cfg?: ControlConfig
): Promise<ControlResult> {
  const config = cfg || (await getControlConfig());
  const token = config.botToken;

  const deps: ControlDeps = {
    answerCallbackQuery: (cbId, text) =>
      tgApi(token, 'answerCallbackQuery', { callback_query_id: cbId, ...(text ? { text } : {}) }),
    editPanel: (chatId, messageId, text) =>
      tgApi(token, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        reply_markup: buildControlKeyboard(),
      }),
    sendPanel: (chatId, text) =>
      tgApi(token, 'sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: buildControlKeyboard(),
      }),
    getBlockState: () =>
      getSetting<Record<string, any>>(STORE_SETTINGS_KEY, {}).then((v) => v || {}),
    applyAction: (action) => applyBlockAction(action),
    allowedChatId: config.chatId,
  };

  return handleControlUpdate(update, deps);
}
