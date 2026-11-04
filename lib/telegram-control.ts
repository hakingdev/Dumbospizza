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
 * Экраны «🍕 Размеры» и «📋 Позиции» — стоп-лист сайта (lib/menu-stop): те же
 * флаги, что админка и POS (библиотека размеров `active`, товар `available`),
 * тем же нажатием — команда агенту Lieferando (dep queueLieferando). Режим
 * кнопок (ряд выбора вверху экрана, хранится в ключе menuStopBot): ⏳ «до конца
 * дня» (по умолчанию, включится само) или ⛔ «бессрочно» (до ручного
 * включения; на Lieferando перевыключается каждое утро — lib/menu-stop/reapply).
 * Позиции, которых нет на сайте, но есть в Lieferando (снимок каталога,
 * lib/lieferando/catalog), показаны там же с пометкой 🛵 — их кнопка ставит
 * агенту команду с точным именем из Hub; «🛵 Сверить с Lieferando» заказывает
 * агенту свежий снимок.
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
  AGENT_OFFLINE_MS,
  getLieferandoState,
  requestLieferandoCommand,
  requestLieferandoToggle,
  type LieferandoAction,
  type LieferandoState,
} from './lieferando-makilove';
import {
  paginate,
  type LieferandoMenuTarget,
  type MenuBotStop,
  type MenuCategoryItems,
  type MenuCategoryRow,
  type MenuItemRow,
  type MenuSizeRow,
  type MenuStopMode,
  type MenuStopPort,
} from './menu-stop/state';
import { buildMenuStopPort } from './menu-stop/service';
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

// Кнопки экрана Lieferando (выключение позиций MakiLove в Partner Hub).
// Выполняет не сервер, а агент на кассовом ПК — см. lib/lieferando-makilove.ts.
export const LIEF_MENU = 'ctrl_lief_menu';
export const LIEF_OFF = 'ctrl_lief_off';
export const LIEF_ON = 'ctrl_lief_on';
export const LIEF_STATUS = 'ctrl_lief_status';
/** Кнопка на экране «📋 Позиции»: заказать агенту свежий снимок каталога Hub. */
export const LIEF_CATALOG = 'ctrl_lief_catalog';

// Экраны «🍕 Размеры» и «📋 Позиции» — стоп-лист сайта (lib/menu-stop) и команда
// агенту Lieferando тем же нажатием. id — 24-hex (у Hub-строк без пары на сайте —
// hub-i<8hex>, у виртуальных категорий Hub — hub-c<8hex>): callback_data ≤ 64 байт.
export const SIZES_MENU = 'ctrl_sz_menu';
export const ITEMS_MENU = 'ctrl_it_menu';
export const ctrlSizeSet = (variationId: string, active: boolean) =>
  `ctrl_sz_${active ? 'on' : 'off'}_${variationId}`;
export const ctrlItemsCategory = (categoryId: string, page = 0) =>
  `ctrl_it_cat_${categoryId}_${page}`;
export const ctrlItemSet = (productId: string, available: boolean, page = 0) =>
  `ctrl_it_${available ? 'on' : 'off'}_${productId}_${page}`;
export const ctrlItemsEnableAll = (categoryId: string, page = 0) =>
  `ctrl_it_all_${categoryId}_${page}`;
/** Позиций на странице экрана категории (у MakiLove их 52). */
export const ITEMS_PAGE_SIZE = 10;

/** Откуда нажали тумблер режима — тот же экран и перерисовываем. */
export type MenuStopBack = { screen: 'sizes' } | { screen: 'items'; categoryId: string; page: number };

/**
 * Тумблер режима «до конца дня» ↔ «бессрочно»: в callback — ЦЕЛЕВОЙ режим и
 * экран возврата. `ctrl_ms_mode_inf_it_<24hex>_<page>` — 48 байт, в лимит 64.
 */
export const ctrlMenuMode = (mode: MenuStopMode, back: MenuStopBack) =>
  `ctrl_ms_mode_${mode === 'indefinite' ? 'inf' : 'day'}_` +
  (back.screen === 'sizes' ? 'sz' : `it_${back.categoryId}_${back.page}`);

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
  | { type: 'root' }
  | { type: 'lief_menu' }
  | { type: 'lief_status' }
  | { type: 'lief_toggle'; action: LieferandoAction }
  | { type: 'sizes_menu' }
  | { type: 'size_set'; variationId: string; active: boolean }
  | { type: 'items_menu' }
  | { type: 'items_category'; categoryId: string; page: number }
  | { type: 'item_set'; productId: string; available: boolean; page: number }
  | { type: 'items_enable_all'; categoryId: string; page: number }
  | { type: 'menu_mode'; mode: MenuStopMode; back: MenuStopBack }
  | { type: 'catalog_sync' };

/** Действия экранов «Размеры»/«Позиции» — отдельный конвейер (lib/menu-stop). */
export type MenuStopAction = Extract<
  ControlAction,
  {
    type:
      | 'sizes_menu'
      | 'size_set'
      | 'items_menu'
      | 'items_category'
      | 'item_set'
      | 'items_enable_all'
      | 'menu_mode'
      | 'catalog_sync';
  }
>;

export type ControlResult = {
  handled: boolean;
  reason:
    | 'blocked'
    | 'unblocked'
    | 'status'
    | 'menu'
    | 'lieferando'
    | 'menu_stop'
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
    case LIEF_MENU:
      return { type: 'lief_menu' };
    case LIEF_STATUS:
      return { type: 'lief_status' };
    case LIEF_OFF:
      return { type: 'lief_toggle', action: 'off' };
    case LIEF_ON:
      return { type: 'lief_toggle', action: 'on' };
    case SIZES_MENU:
      return { type: 'sizes_menu' };
    case ITEMS_MENU:
      return { type: 'items_menu' };
    case LIEF_CATALOG:
      return { type: 'catalog_sync' };
  }

  // Стоп-лист: id — 24-hex (на всякий случай пускаем до 36 символов, UUID).
  const sizeSet = /^ctrl_sz_(on|off)_([A-Za-z0-9-]{1,36})$/.exec(data);
  if (sizeSet) return { type: 'size_set', variationId: sizeSet[2], active: sizeSet[1] === 'on' };
  const itemsCat = /^ctrl_it_cat_([A-Za-z0-9-]{1,36})_(\d{1,3})$/.exec(data);
  if (itemsCat) return { type: 'items_category', categoryId: itemsCat[1], page: Number(itemsCat[2]) };
  const itemSet = /^ctrl_it_(on|off)_([A-Za-z0-9-]{1,36})_(\d{1,3})$/.exec(data);
  if (itemSet) {
    return {
      type: 'item_set',
      productId: itemSet[2],
      available: itemSet[1] === 'on',
      page: Number(itemSet[3]),
    };
  }
  const itemsAll = /^ctrl_it_all_([A-Za-z0-9-]{1,36})_(\d{1,3})$/.exec(data);
  if (itemsAll) return { type: 'items_enable_all', categoryId: itemsAll[1], page: Number(itemsAll[2]) };
  const mode = /^ctrl_ms_mode_(day|inf)_(?:sz|it_([A-Za-z0-9-]{1,36})_(\d{1,3}))$/.exec(data);
  if (mode) {
    return {
      type: 'menu_mode',
      mode: mode[1] === 'inf' ? 'indefinite' : 'day',
      back: mode[2] ? { screen: 'items', categoryId: mode[2], page: Number(mode[3]) } : { screen: 'sizes' },
    };
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

/** С секундами — для heartbeat агента: «Обновить» должен менять текст экрана,
 *  иначе editMessageText падает «message is not modified» и нажатие выглядит
 *  как «ничего не произошло». */
function formatTimeSec(d: Date, timeZone = TZ): string {
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
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
      [
        { text: '🍕 Размеры', callback_data: SIZES_MENU },
        { text: '📋 Позиции', callback_data: ITEMS_MENU },
      ],
      [{ text: '🛵 Lieferando MakiLove', callback_data: LIEF_MENU }],
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

// --- экран Lieferando (позиции MakiLove в Partner Hub) -------------------------

export function buildLieferandoKeyboard(): ControlPanel['keyboard'] {
  return {
    inline_keyboard: [
      [
        { text: '🔴 Выключить всё', callback_data: LIEF_OFF },
        { text: '🟢 Включить всё', callback_data: LIEF_ON },
      ],
      [
        { text: '🔄 Обновить', callback_data: LIEF_STATUS },
        { text: '⬅️ Назад', callback_data: CTRL_ROOT },
      ],
    ],
  };
}

/**
 * Экран Lieferando. Команду выполняет агент на кассовом ПК (поллинг ~20 сек),
 * поэтому показываем весь конвейер: очередь → выполняется → итог + жив ли агент.
 */
export function buildLieferandoText(
  lief: LieferandoState,
  now: Date = new Date(),
  timeZone = TZ
): string {
  const stateLine =
    lief.itemsState === 'off'
      ? '🔴 Позиции ВЫКЛЮЧЕНЫ (по данным последнего запуска)'
      : lief.itemsState === 'on'
        ? '🟢 Позиции включены (по данным последнего запуска)'
        : '⚪️ Состояние ещё не известно';

  const lines = ['🛵 <b>Lieferando — MakiLove</b>', '', stateLine];

  if (lief.command) {
    lines.push(
      `⏳ Команда «${lief.command.action === 'off' ? 'выключить' : 'включить'}» ждёт агента…`
    );
  }
  if (lief.running) {
    lines.push(
      `⚙️ Агент выполняет «${lief.running.action === 'off' ? 'выключить' : 'включить'}» (с ${formatTime(new Date(lief.running.startedAt), timeZone)})`
    );
  }
  if (lief.lastResult) {
    const r = lief.lastResult;
    lines.push(
      r.ok
        ? `Последний запуск: ✅ ${r.action === 'off' ? 'выключено' : 'включено'} ${r.count} позиций в ${formatTime(new Date(r.finishedAt), timeZone)}` +
            (r.failed ? ` (ошибок: ${r.failed})` : '')
        : `Последний запуск: ❌ ${r.message || 'ошибка'} (${formatTime(new Date(r.finishedAt), timeZone)})`
    );
  }

  const seen = lief.agentSeenAt ? new Date(lief.agentSeenAt) : null;
  const offline = !seen || now.getTime() - seen.getTime() > AGENT_OFFLINE_MS;
  lines.push(
    offline
      ? `⚠️ Агент не на связи${seen ? ` (последний раз: ${formatTime(seen, timeZone)})` : ' (ещё ни разу не поллил)'} — проверьте кассовый ПК.`
      : `Агент на связи (${formatTimeSec(seen!, timeZone)}${lief.agentVersion ? `, v ${lief.agentVersion}` : ''}).`
  );

  lines.push('', 'ℹ️ Выключение действует до конца дня — утром Lieferando включит позиции сам.');
  return lines.join('\n');
}

// --- экраны «Размеры» и «Позиции» (стоп-лист сайта, lib/menu-stop) -------------

/** parse_mode HTML: имя товара с «&» или «<» иначе ломает всё сообщение. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Чем и до когда выключено: ботом — «до HH:MM» / «бессрочно», иначе руками (админка/POS, либо в Hub). */
function stoppedNote(botStop: MenuBotStop, timeZone: string, hubOnly = false): string {
  if (!botStop) return hubOnly ? 'выключен на Lieferando' : 'выключен (админка/POS)';
  return botStop.until === null
    ? 'выключен ботом бессрочно'
    : `выключен ботом до ${formatTime(new Date(botStop.until), timeZone)}`;
}

/** 🟢 включено · 🔴 выключено (до конца дня или руками) · ⛔ выключено ботом бессрочно. */
function rowIcon(on: boolean, botStop: MenuBotStop): string {
  if (on) return '🟢';
  return botStop && botStop.until === null ? '⛔' : '🔴';
}

const MENU_HINT = 'Нажмите на строку, чтобы переключить её на сайте и на Lieferando.';
const MODE_HINTS: Record<MenuStopMode, string> = {
  day:
    'ℹ️ Режим ⏳ «до конца дня»: выключенное ботом включится само в конце рабочего дня. ' +
    'Чтобы выключать насовсем — нажмите «⛔ Бессрочно» вверху, затем позицию.',
  indefinite:
    '⛔ Режим «бессрочно»: выключенное останется выключенным, пока не включите кнопкой; ' +
    'на Lieferando бот перевыключает его каждое утро. Ночью режим сам вернётся на «до конца дня».',
};

/**
 * Ряд выбора режима — два явных варианта, текущий отмечен галочкой. Одна
 * кнопка-тумблер («Режим: ⏳ до конца дня») читалась как надпись-статус, и
 * персонал не находил, где выключить бессрочно.
 */
function modeRow(mode: MenuStopMode, back: MenuStopBack): Array<{ text: string; callback_data: string }> {
  const mark = (own: MenuStopMode, label: string) => (mode === own ? `✓ ${label}` : label);
  return [
    { text: mark('day', '⏳ До конца дня'), callback_data: ctrlMenuMode('day', back) },
    { text: mark('indefinite', '⛔ Бессрочно'), callback_data: ctrlMenuMode('indefinite', back) },
  ];
}

/** Кнопки по две в ряд — списки короткие, а экран вытягивать не хочется. */
function pairRows<T>(buttons: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return rows;
}

export function buildSizesText(
  sizes: MenuSizeRow[],
  mode: MenuStopMode,
  now: Date = new Date(),
  timeZone = TZ
): string {
  const lines = ['🍕 <b>Размеры</b> — вся библиотека: размер гаснет у всех товаров сразу', ''];
  if (!sizes.length) lines.push('Библиотека размеров пуста.');
  for (const s of sizes) {
    const title = esc(s.label && s.label !== s.name ? `${s.name} · ${s.label}` : s.name);
    const icon = rowIcon(s.active, s.botStop);
    lines.push(s.active ? `${icon} ${title}` : `${icon} ${title} — ${stoppedNote(s.botStop, timeZone)}`);
  }
  lines.push('', MENU_HINT, MODE_HINTS[mode], `Обновлено ${formatTimeSec(now, timeZone)}`);
  return lines.join('\n');
}

export function buildSizesKeyboard(sizes: MenuSizeRow[], mode: MenuStopMode): ControlPanel['keyboard'] {
  return {
    inline_keyboard: [
      modeRow(mode, { screen: 'sizes' }),
      ...pairRows(
        sizes.map((s) => ({
          text: `${rowIcon(s.active, s.botStop)} ${s.name}`,
          callback_data: ctrlSizeSet(s.id, !s.active),
        }))
      ),
      [
        { text: '🔄 Обновить', callback_data: SIZES_MENU },
        { text: '⬅️ Назад', callback_data: CTRL_ROOT },
      ],
    ],
  };
}

export function buildItemCategoriesText(
  categories: MenuCategoryRow[],
  now: Date = new Date(),
  timeZone = TZ
): string {
  const lines = ['📋 <b>Позиции</b> — стоп-лист по категориям', ''];
  if (!categories.length) lines.push('Активных категорий нет.');
  for (const c of categories) {
    lines.push(
      `${c.stoppedCount ? '🔴' : '🟢'} ${c.hubOnly ? '🛵 ' : ''}${esc(c.name)} — ${c.itemCount}` +
        (c.stoppedCount ? `, выключено: ${c.stoppedCount}` : '') +
        (c.hubOnly ? ' (только Lieferando)' : '')
    );
  }
  if (categories.some((c) => c.hubOnly)) {
    lines.push('', '🛵 — категория есть только на Lieferando (по снимку каталога).');
  }
  lines.push('', 'Выберите категорию.', `Обновлено ${formatTimeSec(now, timeZone)}`);
  return lines.join('\n');
}

export function buildItemCategoriesKeyboard(categories: MenuCategoryRow[]): ControlPanel['keyboard'] {
  return {
    inline_keyboard: [
      ...pairRows(
        categories.map((c) => ({
          text: `${c.hubOnly ? '🛵 ' : ''}${c.name}${c.stoppedCount ? ` (🔴 ${c.stoppedCount})` : ''}`,
          callback_data: ctrlItemsCategory(c.id, 0),
        }))
      ),
      [{ text: '🛵 Сверить с Lieferando', callback_data: LIEF_CATALOG }],
      [
        { text: '🔄 Обновить', callback_data: ITEMS_MENU },
        { text: '⬅️ Назад', callback_data: CTRL_ROOT },
      ],
    ],
  };
}

export function buildItemsText(
  category: MenuCategoryRow | null,
  items: MenuItemRow[],
  page: number,
  mode: MenuStopMode,
  now: Date = new Date(),
  timeZone = TZ,
  hubSnapshotAt?: string | null
): string {
  if (!category) return '📋 Категория не найдена — возможно, её удалили в админке.';
  const { page: p, pages, slice } = paginate(items, page, ITEMS_PAGE_SIZE);
  const stopped = items.filter((i) => !i.available).length;
  const lines = [
    `📋 <b>${esc(category.name)}</b> — позиций: ${items.length}` +
      (stopped ? `, выключено: ${stopped}` : '') +
      (pages > 1 ? ` · стр. ${p + 1}/${pages}` : ''),
    '',
  ];
  if (!items.length) lines.push('В категории нет позиций.');
  for (const i of slice) {
    const icon = rowIcon(i.available, i.botStop);
    const title = `${i.hubOnly ? '🛵 ' : ''}${esc(i.name)}`;
    lines.push(
      i.available ? `${icon} ${title}` : `${icon} ${title} — ${stoppedNote(i.botStop, timeZone, i.hubOnly)}`
    );
  }
  if (items.some((i) => i.hubOnly)) {
    const at = hubSnapshotAt ? ` (снимок ${formatTime(new Date(hubSnapshotAt), timeZone)})` : '';
    lines.push('', `🛵 — только на Lieferando, на сайте такого товара нет${at}: переключается только там.`);
  }
  lines.push('', MENU_HINT, MODE_HINTS[mode], `Обновлено ${formatTimeSec(now, timeZone)}`);
  return lines.join('\n');
}

export function buildItemsKeyboard(
  categoryId: string,
  items: MenuItemRow[],
  page: number,
  mode: MenuStopMode
): ControlPanel['keyboard'] {
  const { page: p, pages, slice } = paginate(items, page, ITEMS_PAGE_SIZE);
  const rows: ControlPanel['keyboard']['inline_keyboard'] = [
    modeRow(mode, { screen: 'items', categoryId, page: p }),
    ...slice.map((i) => [
      {
        text: `${rowIcon(i.available, i.botStop)} ${i.hubOnly ? '🛵 ' : ''}${i.name}`,
        callback_data: ctrlItemSet(i.id, !i.available, p),
      },
    ]),
  ];
  if (pages > 1) {
    const nav = [];
    if (p > 0) nav.push({ text: '⬅️', callback_data: ctrlItemsCategory(categoryId, p - 1) });
    nav.push({ text: `${p + 1}/${pages}`, callback_data: ctrlItemsCategory(categoryId, p) });
    if (p < pages - 1) nav.push({ text: '➡️', callback_data: ctrlItemsCategory(categoryId, p + 1) });
    rows.push(nav);
  }
  if (items.length) {
    rows.push([{ text: '🟢 Включить всё в категории', callback_data: ctrlItemsEnableAll(categoryId, p) }]);
  }
  rows.push([
    { text: '📋 Категории', callback_data: ITEMS_MENU },
    { text: '⬅️ Назад', callback_data: CTRL_ROOT },
  ]);
  return { inline_keyboard: rows };
}

/** Экран целиком (текст + клавиатура) по действию/навигации. */
export function buildPanel(
  view:
    | { type: 'root' }
    | { type: 'scope'; scope: ControlScope }
    | { type: 'lieferando'; lief: LieferandoState }
    | { type: 'sizes'; sizes: MenuSizeRow[]; mode: MenuStopMode }
    | { type: 'item_categories'; categories: MenuCategoryRow[] }
    | {
        type: 'items';
        categoryId: string;
        category: MenuCategoryRow | null;
        items: MenuItemRow[];
        page: number;
        mode: MenuStopMode;
        /** takenAt снимка Lieferando — если в списке есть Hub-строки без пары */
        hubSnapshotAt?: string | null;
      },
  state: BlockState,
  now: Date = new Date(),
  timeZone = TZ
): ControlPanel {
  if (view.type === 'root') {
    return { text: buildRootText(state, now, timeZone), keyboard: buildRootKeyboard() };
  }
  if (view.type === 'lieferando') {
    return {
      text: buildLieferandoText(view.lief, now, timeZone),
      keyboard: buildLieferandoKeyboard(),
    };
  }
  if (view.type === 'sizes') {
    return {
      text: buildSizesText(view.sizes, view.mode, now, timeZone),
      keyboard: buildSizesKeyboard(view.sizes, view.mode),
    };
  }
  if (view.type === 'item_categories') {
    return {
      text: buildItemCategoriesText(view.categories, now, timeZone),
      keyboard: buildItemCategoriesKeyboard(view.categories),
    };
  }
  if (view.type === 'items') {
    return {
      text: buildItemsText(view.category, view.items, view.page, view.mode, now, timeZone, view.hubSnapshotAt),
      keyboard: view.category
        ? buildItemsKeyboard(view.categoryId, view.items, view.page, view.mode)
        : {
            inline_keyboard: [
              [
                { text: '📋 Категории', callback_data: ITEMS_MENU },
                { text: '⬅️ Назад', callback_data: CTRL_ROOT },
              ],
            ],
          },
    };
  }
  return {
    text: buildScopeText(view.scope, state, now, timeZone),
    keyboard: buildScopeKeyboard(view.scope),
  };
}

/** Тост «жив ли агент» — видимый ответ на КАЖДОЕ нажатие экрана Lieferando,
 *  даже когда текст панели не изменился и edit молча не прошёл. */
function liefAgentToast(lief: LieferandoState, now: Date = new Date()): string {
  const seen = lief.agentSeenAt ? new Date(lief.agentSeenAt) : null;
  const offline = !seen || now.getTime() - seen.getTime() > AGENT_OFFLINE_MS;
  return offline
    ? '🔴 Агент офлайн — проверьте кассовый ПК'
    : `🟢 Агент на связи (${formatTimeSec(seen!)})`;
}

/** Короткий toast для answerCallbackQuery. */
function toastFor(action: ControlAction, state: BlockState, now: Date = new Date()): string {
  if (action.type === 'root' || action.type === 'menu') return '';
  if (action.type === 'lief_menu' || action.type === 'lief_status' || action.type === 'lief_toggle')
    return '';
  if (isMenuStopAction(action)) return '';
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

const MENU_STOP_TYPES: ReadonlySet<ControlAction['type']> = new Set<ControlAction['type']>([
  'sizes_menu',
  'size_set',
  'items_menu',
  'items_category',
  'item_set',
  'items_enable_all',
  'menu_mode',
  'catalog_sync',
]);

export function isMenuStopAction(action: ControlAction): action is MenuStopAction {
  return MENU_STOP_TYPES.has(action.type);
}

/**
 * Экран «Размеры»/«Позиции» после действия: сначала флаг сайта, затем —
 * best-effort — команда агенту Lieferando. Сайт уже переключён, поэтому сбой
 * очереди Lieferando не откатывает ничего, а попадает в тост.
 */
async function menuStopScreen(
  action: MenuStopAction,
  menu: MenuStopPort,
  queueLieferando: ControlDeps['queueLieferando'],
  now: Date,
  log: (...args: any[]) => void
): Promise<{ panel: ControlPanel; toast: string }> {
  const lieferando = async (
    liefAction: LieferandoAction,
    target: LieferandoMenuTarget,
    indefinite: boolean
  ) => {
    if (!queueLieferando) return 'Lieferando не настроен';
    try {
      await queueLieferando(liefAction, target, { indefinite });
      return '📤 Lieferando: команда агенту';
    } catch (e) {
      log('queueLieferando failed', (e as Error)?.message);
      return '⚠️ Lieferando: команда не поставлена';
    }
  };
  const sizesPanel = async () => {
    const [sizes, mode] = await Promise.all([menu.listSizes(), menu.getMode()]);
    return buildPanel({ type: 'sizes', sizes, mode }, EMPTY_BLOCK_STATE, now);
  };
  const categoriesPanel = async () =>
    buildPanel(
      { type: 'item_categories', categories: await menu.listCategories() },
      EMPTY_BLOCK_STATE,
      now
    );
  const itemsPanel = async (categoryId: string, page: number) => {
    const [screen, mode] = await Promise.all([menu.listCategoryItems(categoryId), menu.getMode()]);
    const { category, items, hubSnapshotAt }: MenuCategoryItems = screen;
    return buildPanel(
      { type: 'items', categoryId, category, items, page, mode, hubSnapshotAt },
      EMPTY_BLOCK_STATE,
      now
    );
  };
  const refreshed = `🔄 Обновлено ${formatTimeSec(now)}`;
  /** «выключен на сайте до 21:30» / «… бессрочно» — по записи, которую только что сделал порт. */
  const offNote = (botStop: MenuBotStop) =>
    botStop && botStop.until === null
      ? 'бессрочно'
      : `до ${formatTime(new Date(botStop?.until ?? now))}`;
  const isIndefinite = (botStop: MenuBotStop) => Boolean(botStop && botStop.until === null);

  switch (action.type) {
    case 'sizes_menu':
      return { panel: await sizesPanel(), toast: refreshed };
    case 'size_set': {
      const row = await menu.setSizeActive(action.variationId, action.active);
      if (!row) return { panel: await sizesPanel(), toast: '⚠️ Размер не найден' };
      const lief = await lieferando(
        action.active ? 'on' : 'off',
        { kind: 'size', label: row.name },
        !action.active && isIndefinite(row.botStop)
      );
      const toast = action.active
        ? `🟢 ${row.name}: включён на сайте · ${lief}`
        : `${rowIcon(false, row.botStop)} ${row.name}: выключен на сайте ${offNote(row.botStop)} · ${lief}`;
      return { panel: await sizesPanel(), toast };
    }
    case 'items_menu':
      return { panel: await categoriesPanel(), toast: refreshed };
    case 'items_category':
      return { panel: await itemsPanel(action.categoryId, action.page), toast: '' };
    case 'item_set': {
      const row = await menu.setItemAvailable(action.productId, action.available);
      if (!row) return { panel: await categoriesPanel(), toast: '⚠️ Позиция не найдена' };
      // Hub-строка без пары на сайте: имя — точное из Hub, на сайте переключать нечего.
      const lief = await lieferando(
        action.available ? 'on' : 'off',
        { kind: 'item', names: [row.name] },
        !action.available && isIndefinite(row.botStop)
      );
      const toast = row.hubOnly
        ? action.available
          ? `🟢 ${row.name}: только Lieferando · ${lief}`
          : `${rowIcon(false, row.botStop)} ${row.name}: только Lieferando, ${isIndefinite(row.botStop) ? 'бессрочно' : 'до утра'} · ${lief}`
        : action.available
          ? `🟢 ${row.name}: включена на сайте · ${lief}`
          : `${rowIcon(false, row.botStop)} ${row.name}: выключена на сайте ${offNote(row.botStop)} · ${lief}`;
      return { panel: await itemsPanel(row.categoryId, action.page), toast };
    }
    case 'items_enable_all': {
      const enabled = await menu.enableCategoryItems(action.categoryId);
      const toast = enabled.length
        ? `🟢 Включено позиций: ${enabled.length} · ${await lieferando(
            'on',
            { kind: 'item', names: enabled.map((i) => i.name) },
            false
          )}`
        : 'Все позиции категории уже включены';
      return { panel: await itemsPanel(action.categoryId, action.page), toast };
    }
    case 'menu_mode': {
      const mode = await menu.setMode(action.mode);
      const toast =
        mode === 'indefinite'
          ? '⛔ Режим «бессрочно»: выключенное останется до ручного включения'
          : '⏳ Режим «до конца дня»: выключенное включится само вечером';
      const panel =
        action.back.screen === 'sizes'
          ? await sizesPanel()
          : await itemsPanel(action.back.categoryId, action.back.page);
      return { panel, toast };
    }
    case 'catalog_sync': {
      // Снимок снимает агент (2–3 мин); сводку в группу шлёт сервер, только если есть изменения.
      const lief = await lieferando('on', { kind: 'catalog' }, false);
      const toast = queueLieferando
        ? `${lief} · снимок каталога займёт пару минут, сводка придёт в группу при изменениях`
        : lief;
      return { panel: await categoriesPanel(), toast };
    }
  }
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
  /** Экран Lieferando (опционально — без них кнопка отвечает «не настроено»). */
  getLieferandoState?: () => PromiseLike<LieferandoState>;
  requestLieferandoToggle?: (action: LieferandoAction) => PromiseLike<LieferandoState>;
  /** Экраны «Размеры»/«Позиции» (опционально — без порта кнопки отвечают «не настроено»). */
  menu?: MenuStopPort;
  /**
   * Тем же нажатием — команда агенту Lieferando (контракт lib/lieferando-makilove
   * `requestLieferandoCommand`). Без dep переключается только сайт, тост
   * предупреждает «Lieferando не настроен». `indefinite` — выключение в режиме
   * «бессрочно» (отчёт агента скажет, что утром бот перевыключит сам).
   */
  queueLieferando?: (
    action: LieferandoAction,
    target: LieferandoMenuTarget,
    options: { indefinite: boolean }
  ) => PromiseLike<unknown>;
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

    // Экран Lieferando — отдельный конвейер: пишем КОМАНДУ агенту, а не блокировку.
    if (
      action.type === 'lief_menu' ||
      action.type === 'lief_status' ||
      action.type === 'lief_toggle'
    ) {
      if (!deps.getLieferandoState || !deps.requestLieferandoToggle) {
        await ack('Lieferando не настроен');
        return { handled: false, reason: 'error' };
      }
      let lief: LieferandoState;
      try {
        lief =
          action.type === 'lief_toggle'
            ? await deps.requestLieferandoToggle(action.action)
            : await deps.getLieferandoState();
      } catch (e) {
        log('lieferando action failed', (e as Error)?.message);
        await ack('Ошибка сохранения');
        return { handled: false, reason: 'error' };
      }
      await ack(
        action.type === 'lief_toggle'
          ? `📤 Команда агенту: ${action.action === 'off' ? 'выключить' : 'включить'} MakiLove`
          : liefAgentToast(lief)
      );
      const messageId = cbq?.message?.message_id;
      if (messageId != null) {
        try {
          await deps.editPanel(
            chatId,
            messageId,
            buildPanel({ type: 'lieferando', lief }, EMPTY_BLOCK_STATE)
          );
        } catch (e) {
          log('editPanel failed', (e as Error)?.message);
        }
      }
      return { handled: true, reason: 'lieferando' };
    }

    // Экраны «Размеры»/«Позиции» — стоп-лист сайта (lib/menu-stop), не блокировки.
    if (isMenuStopAction(action)) {
      if (!deps.menu) {
        await ack('Стоп-лист из бота не настроен');
        return { handled: false, reason: 'error' };
      }
      let screen: { panel: ControlPanel; toast: string };
      try {
        screen = await menuStopScreen(action, deps.menu, deps.queueLieferando, new Date(), log);
      } catch (e) {
        log('menu-stop action failed', (e as Error)?.message);
        await ack('Ошибка сохранения');
        return { handled: false, reason: 'error' };
      }
      await ack(screen.toast || undefined);
      const messageId = cbq?.message?.message_id;
      if (messageId != null) {
        try {
          await deps.editPanel(chatId, messageId, screen.panel);
        } catch (e) {
          log('editPanel failed', (e as Error)?.message);
        }
      }
      return { handled: true, reason: 'menu_stop' };
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
    getLieferandoState: () => getLieferandoState(),
    requestLieferandoToggle: (action) => requestLieferandoToggle(action),
    menu: buildMenuStopPort(),
    // то же нажатие — команда агенту Lieferando (очередь lib/lieferando-makilove)
    queueLieferando: (action, target, { indefinite }) =>
      requestLieferandoCommand(action, target, new Date(), {
        origin: indefinite ? 'indefinite' : 'bot',
      }),
    allowedChatId: config.chatId,
  };

  return handleControlUpdate(update, deps);
}

/** Служебное сообщение в группу стоп-бота (например, отчёт агента Lieferando). */
export async function sendControlMessage(text: string): Promise<boolean> {
  const cfg = await getControlConfig();
  if (!cfg.botToken || !cfg.chatId) return false;
  try {
    const res = await tgApi(cfg.botToken, 'sendMessage', {
      chat_id: cfg.chatId,
      text,
      parse_mode: 'HTML',
    });
    return Boolean(res?.ok);
  } catch (e) {
    console.error('[tg-control] sendControlMessage failed', (e as Error)?.message);
    return false;
  }
}
