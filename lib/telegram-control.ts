/**
 * Stop-бот приёма заказов — ОТДЕЛЬНЫЙ Telegram-бот в служебной группе.
 *
 * Останавливает приём заказов: целиком либо ПО ЦЕХАМ (lib/kitchen/workshops.ts):
 *   - 🍕 Пицца и Beilagen — всё, что не суши;
 *   - 🍣 MakiLove (суши)  — своя станция, свои руки.
 * Панель двухуровневая: корень со статусом → меню цеха с теми же кнопками, что
 * были раньше (Блок 30 / Блок 60 / Разблокировать / Обновить).
 *
 * Ничего в логике приёма НЕ дублирует — пишет в единые источники правды в
 * `storeSettings`, которые уважают сервер, сайт, мобилка и админка:
 *   - `ordersBlockedUntil`      — глобальный стоп (сильнее цехов);
 *   - `workshopsBlockedUntil`   — { pizza, sushi }, стоп отдельного цеха.
 * Читают их:
 *   - сервер:  app/api/orders/route.ts       (403 на весь заказ / на позиции цеха)
 *   - сайт:    app/(main)/checkout/page.tsx  (баннер «кухня загружена»)
 *   - мобилка: app/api/mobile/v1/bootstrap
 *   - клиент:  app/api/kitchen/blocks        (что сейчас на паузе)
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
import {
  EMPTY_WORKSHOP_BLOCKS,
  WORKSHOPS,
  WORKSHOP_BLOCKS_KEY,
  WORKSHOP_IDS,
  isBlockActive,
  readWorkshopBlocks,
  type WorkshopBlocks,
  type WorkshopId,
} from './kitchen/workshops';

const STORE_SETTINGS_KEY = 'storeSettings';
const TZ = 'Europe/Berlin';

/** Чем управляет экран: весь приём или конкретный цех. */
export type ControlScope = 'all' | WorkshopId;

export const CONTROL_SCOPES: readonly ControlScope[] = ['all', ...WORKSHOP_IDS] as const;

const SCOPE_LABELS: Record<ControlScope, string> = {
  all: '🏪 Весь приём',
  pizza: `${WORKSHOPS.pizza.emoji} ${WORKSHOPS.pizza.ru}`,
  sushi: `${WORKSHOPS.sushi.emoji} ${WORKSHOPS.sushi.ru}`,
};

// callback_data кнопок панели (префикс ctrl_ — не пересекается со status_ бота заказов)
export const CTRL_ROOT = 'ctrl_root';
export const ctrlMenu = (scope: ControlScope) => `ctrl_menu_${scope}`;
export const ctrlBlock = (scope: ControlScope, minutes: 30 | 60) =>
  `ctrl_${scope}_block_${minutes}`;
export const ctrlUnblock = (scope: ControlScope) => `ctrl_${scope}_unblock`;
export const ctrlStatus = (scope: ControlScope) => `ctrl_${scope}_status`;

/** Старые кнопки (панель до появления цехов) — трактуем как «весь приём». */
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
  | { type: 'block'; scope: ControlScope; minutes: number }
  | { type: 'unblock'; scope: ControlScope }
  | { type: 'status'; scope: ControlScope }
  | { type: 'menu'; scope: ControlScope }
  | { type: 'root' };

export type ControlResult = {
  handled: boolean;
  reason:
    | 'blocked'
    | 'unblocked'
    | 'status'
    | 'menu'
    | 'panel'
    | 'wrong_chat'
    | 'not_ours'
    | 'error';
};

/** Снимок всех блокировок: глобальная + по цехам. */
export interface BlockState {
  /** storeSettings.ordersBlockedUntil ('' = приём открыт) */
  orders: string;
  workshops: WorkshopBlocks;
}

export const EMPTY_BLOCK_STATE: BlockState = {
  orders: '',
  workshops: { ...EMPTY_WORKSHOP_BLOCKS },
};

/** Что сейчас стоит для конкретного экрана. */
function untilForScope(state: BlockState, scope: ControlScope): string {
  return scope === 'all' ? state.orders : state.workshops[scope] || '';
}

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

const isScope = (value: string): value is ControlScope =>
  (CONTROL_SCOPES as readonly string[]).includes(value);

/** callback_data → действие, либо null если кнопка не наша. */
export function parseControlAction(data: unknown): ControlAction | null {
  if (typeof data !== 'string' || !data) return null;

  // Старые кнопки без цеха — весь приём.
  switch (data) {
    case CTRL_BLOCK_30:
      return { type: 'block', scope: 'all', minutes: 30 };
    case CTRL_BLOCK_60:
      return { type: 'block', scope: 'all', minutes: 60 };
    case CTRL_UNBLOCK:
      return { type: 'unblock', scope: 'all' };
    case CTRL_STATUS:
      return { type: 'status', scope: 'all' };
    case CTRL_ROOT:
      return { type: 'root' };
  }

  const menu = /^ctrl_menu_([a-z]+)$/.exec(data);
  if (menu && isScope(menu[1])) return { type: 'menu', scope: menu[1] };

  const scoped = /^ctrl_([a-z]+)_(block_30|block_60|unblock|status)$/.exec(data);
  if (scoped && isScope(scoped[1])) {
    const scope = scoped[1];
    switch (scoped[2]) {
      case 'block_30':
        return { type: 'block', scope, minutes: 30 };
      case 'block_60':
        return { type: 'block', scope, minutes: 60 };
      case 'unblock':
        return { type: 'unblock', scope };
      default:
        return { type: 'status', scope };
    }
  }

  return null;
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

// --- чтение и запись состояния блокировок (read-modify-write) ------------------

export function readBlockState(settings: Record<string, any> | null | undefined): BlockState {
  return {
    orders: typeof settings?.ordersBlockedUntil === 'string' ? settings.ordersBlockedUntil : '',
    workshops: readWorkshopBlocks(settings),
  };
}

/**
 * Применяет действие к storeSettings, меняя ТОЛЬКО ключи блокировок.
 * read-modify-write обязателен: setSetting перезаписывает объект целиком, иначе
 * затрём остальные настройки магазина. Для 'status'/'menu'/'root' не пишет.
 *
 * «Разблокировать» на экране всего приёма снимает и цеховые стопы — это кнопка
 * «открываем всё», иначе персонал снимет глобальный стоп и не поймёт, почему
 * суши всё ещё не принимаются.
 */
export async function applyBlockAction(
  action: ControlAction,
  now: Date = new Date()
): Promise<BlockState> {
  const current = (await getSetting<Record<string, any>>(STORE_SETTINGS_KEY, {})) || {};
  const state = readBlockState(current);

  if (action.type !== 'block' && action.type !== 'unblock') {
    return state;
  }

  const until =
    action.type === 'block'
      ? new Date(now.getTime() + action.minutes * 60_000).toISOString()
      : '';

  const next: BlockState =
    action.scope === 'all'
      ? {
          orders: until,
          workshops: until ? state.workshops : { ...EMPTY_WORKSHOP_BLOCKS },
        }
      : {
          orders: state.orders,
          workshops: { ...state.workshops, [action.scope]: until },
        };

  await setSetting(STORE_SETTINGS_KEY, {
    ...current,
    ordersBlockedUntil: next.orders,
    [WORKSHOP_BLOCKS_KEY]: next.workshops,
  });
  return next;
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

/** «🔴 стоп до 19:40» / «🟢 работает» для строки статуса. */
function statusLabel(until: string, now: Date, timeZone: string): string {
  return isBlockActive(until, now)
    ? `🔴 стоп до ${formatTime(new Date(until), timeZone)}`
    : '🟢 работает';
}

export interface ControlPanel {
  text: string;
  keyboard: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
}

export function buildRootKeyboard(): ControlPanel['keyboard'] {
  return {
    inline_keyboard: [
      ...WORKSHOP_IDS.map((id) => [{ text: SCOPE_LABELS[id], callback_data: ctrlMenu(id) }]),
      [{ text: SCOPE_LABELS.all, callback_data: ctrlMenu('all') }],
      [{ text: '🔄 Обновить', callback_data: CTRL_ROOT }],
    ],
  };
}

export function buildScopeKeyboard(scope: ControlScope): ControlPanel['keyboard'] {
  return {
    inline_keyboard: [
      [
        { text: '🔴 Блок 30 мин', callback_data: ctrlBlock(scope, 30) },
        { text: '🔴 Блок 60 мин', callback_data: ctrlBlock(scope, 60) },
      ],
      [
        { text: '🟢 Разблокировать', callback_data: ctrlUnblock(scope) },
        { text: '🔄 Обновить', callback_data: ctrlStatus(scope) },
      ],
      [{ text: '⬅️ Назад', callback_data: CTRL_ROOT }],
    ],
  };
}

/** Корневой экран: статус всего приёма и обоих цехов. Снимок на момент рендера. */
export function buildRootText(
  state: BlockState,
  now: Date = new Date(),
  timeZone = TZ
): string {
  const lines = [
    '🛑 <b>Управление приёмом заказов</b>',
    '',
    `${SCOPE_LABELS.all} — ${statusLabel(state.orders, now, timeZone)}`,
    ...WORKSHOP_IDS.map(
      (id) => `${SCOPE_LABELS[id]} — ${statusLabel(state.workshops[id], now, timeZone)}`
    ),
    '',
  ];
  lines.push(
    isBlockActive(state.orders, now)
      ? '⚠️ Весь приём остановлен — цеха не принимают ничего, пока он не открыт.'
      : 'Выберите, чем управлять.'
  );
  return lines.join('\n');
}

/** Экран одного цеха (или всего приёма) с кнопками блокировки. */
export function buildScopeText(
  scope: ControlScope,
  state: BlockState,
  now: Date = new Date(),
  timeZone = TZ
): string {
  const until = untilForScope(state, scope);
  const active = isBlockActive(until, now);
  const header = `${SCOPE_LABELS[scope]}`;

  if (scope === 'all') {
    const body = active
      ? `🔴 <b>ПРИЁМ ЗАБЛОКИРОВАН</b> до ${formatTime(new Date(until), timeZone)}\nНовые заказы отклоняются.`
      : '🟢 <b>ПРИЁМ АКТИВЕН</b>\nЗаказы принимаются.';
    const workshopLines = WORKSHOP_IDS.map(
      (id) => `${SCOPE_LABELS[id]} — ${statusLabel(state.workshops[id], now, timeZone)}`
    ).join('\n');
    return [`<b>${header}</b>`, '', body, '', workshopLines].join('\n');
  }

  const other = WORKSHOP_IDS.filter((id) => id !== scope);
  const body = active
    ? `🔴 <b>ЦЕХ ОСТАНОВЛЕН</b> до ${formatTime(new Date(until), timeZone)}\nЗаказы с позициями этого цеха отклоняются.`
    : '🟢 <b>ЦЕХ РАБОТАЕТ</b>\nПозиции этого цеха принимаются.';
  const siblings = other
    .map((id) => `${SCOPE_LABELS[id]} — ${statusLabel(state.workshops[id], now, timeZone)}`)
    .join('\n');
  const globalHint = isBlockActive(state.orders, now)
    ? '⚠️ Сейчас остановлен весь приём — цех всё равно ничего не получит.'
    : '';
  return [`<b>${header}</b>`, '', body, '', siblings, globalHint]
    .filter((line) => line !== '')
    .join('\n');
}

/** Экран целиком (текст + клавиатура) по действию/навигации. */
export function buildPanel(
  view: { type: 'root' } | { type: 'scope'; scope: ControlScope },
  state: BlockState,
  now: Date = new Date(),
  timeZone = TZ
): ControlPanel {
  if (view.type === 'root') {
    return { text: buildRootText(state, now, timeZone), keyboard: buildRootKeyboard() };
  }
  return {
    text: buildScopeText(view.scope, state, now, timeZone),
    keyboard: buildScopeKeyboard(view.scope),
  };
}

/** Короткий toast для answerCallbackQuery. */
function toastFor(action: ControlAction, state: BlockState, now: Date = new Date()): string {
  if (action.type === 'root' || action.type === 'menu') return '';
  const until = untilForScope(state, action.scope);
  const what = action.scope === 'all' ? 'Приём' : WORKSHOPS[action.scope].ru;
  if (action.type === 'block' && until) {
    return `⛔️ ${what}: блок до ${formatTime(new Date(until))}`;
  }
  if (action.type === 'unblock') return `✅ ${what}: открыт`;
  return isBlockActive(until, now)
    ? `🔴 ${what}: блок до ${formatTime(new Date(until))}`
    : `🟢 ${what}: работает`;
}

// --- ядро обработки (изолировано от Telegram/БД через deps — тестируется) ------

export interface ControlDeps {
  answerCallbackQuery: (id: string, text?: string) => PromiseLike<unknown>;
  editPanel: (
    chatId: number | string,
    messageId: number,
    panel: ControlPanel
  ) => PromiseLike<unknown>;
  sendPanel: (chatId: number | string, panel: ControlPanel) => PromiseLike<unknown>;
  getBlockState: () => PromiseLike<Record<string, any>>;
  applyAction: (action: ControlAction, now?: Date) => PromiseLike<BlockState>;
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

    // Навигация (⬅️ Назад / открыть цех) ничего не пишет — только перерисовка.
    let state: BlockState;
    try {
      state =
        action.type === 'root' || action.type === 'menu'
          ? readBlockState(await deps.getBlockState())
          : await deps.applyAction(action);
    } catch (e) {
      log('applyAction failed', (e as Error)?.message);
      await ack('Ошибка сохранения');
      return { handled: false, reason: 'error' };
    }

    await ack(toastFor(action, state));

    const messageId = cbq?.message?.message_id;
    if (messageId != null) {
      const view =
        action.type === 'root'
          ? ({ type: 'root' } as const)
          : ({ type: 'scope', scope: action.scope } as const);
      try {
        // best-effort: editMessageText кидает «message is not modified», если
        // текст не изменился (напр. повторное Обновить) — глотаем.
        await deps.editPanel(chatId, messageId, buildPanel(view, state));
      } catch (e) {
        log('editPanel failed', (e as Error)?.message);
      }
    }

    const reason: ControlResult['reason'] =
      action.type === 'block'
        ? 'blocked'
        : action.type === 'unblock'
          ? 'unblocked'
          : action.type === 'status'
            ? 'status'
            : 'menu';
    return { handled: true, reason };
  }

  // 2) Команда /panel | /start — публикуем свежий корневой экран
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
    const state = readBlockState(await deps.getBlockState());
    try {
      await deps.sendPanel(chatId, buildPanel({ type: 'root' }, state));
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
    editPanel: (chatId, messageId, panel) =>
      tgApi(token, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: panel.text,
        parse_mode: 'HTML',
        reply_markup: panel.keyboard,
      }),
    sendPanel: (chatId, panel) =>
      tgApi(token, 'sendMessage', {
        chat_id: chatId,
        text: panel.text,
        parse_mode: 'HTML',
        reply_markup: panel.keyboard,
      }),
    getBlockState: () =>
      getSetting<Record<string, any>>(STORE_SETTINGS_KEY, {}).then((v) => v || {}),
    applyAction: (action) => applyBlockAction(action),
    allowedChatId: config.chatId,
  };

  return handleControlUpdate(update, deps);
}
