/**
 * Режим форума для группы заказов: карточка заказа живёт в теме своего статуса
 * и «переезжает» между темами при смене статуса.
 *
 *   🔥 Готовится      → TOPIC_COOKING     (new, preparing)
 *   📦 Готов к доставке → TOPIC_READY      (ready_for_delivery)
 *   🚗 В пути          → TOPIC_ON_THE_WAY  (delivering)
 *   ✅ Доставлен       → TOPIC_DELIVERED   (completed)
 *   ❌ Отменён         → TOPIC_CANCELLED   (cancelled; по умолчанию = тема «Доставлен» как архив)
 *
 * Темы создаются ОДИН раз (scripts/telegram-topics.ts), их id живут в конфиге —
 * бот их не создаёт и не ищет при каждом заказе.
 *
 * Конфиг читается как у остальных ботов: сначала storeSettings (Supabase),
 * фолбэк — env. Если режим выключен или тема не задана хотя бы одна из четырёх
 * обязательных — весь форумный код молчит, и бот работает по-старому (одно
 * сообщение, редактируемое на месте). Это защита от «включили флаг, темы не
 * создали» — заказы в такой ситуации не должны теряться.
 */
import { getSetting } from '../settings';

const STORE_SETTINGS_KEY = 'storeSettings';

/** Тема форума = состояние карточки. Не путать со статусом заказа в БД. */
export type CardStatus = 'cooking' | 'ready' | 'on_the_way' | 'delivered' | 'cancelled';

export const CARD_STATUSES: readonly CardStatus[] = [
  'cooking',
  'ready',
  'on_the_way',
  'delivered',
  'cancelled',
];

/** Обязательные темы: без любой из них режим форума не включается. */
const REQUIRED_TOPICS: readonly CardStatus[] = ['cooking', 'ready', 'on_the_way', 'delivered'];

export const CARD_STATUS_EMOJI: Record<CardStatus, string> = {
  cooking: '🔥',
  ready: '📦',
  on_the_way: '🚗',
  delivered: '✅',
  cancelled: '❌',
};

export const CARD_STATUS_LABELS: Record<CardStatus, string> = {
  cooking: '🔥 Готовится',
  ready: '📦 Готов к доставке',
  on_the_way: '🚗 В пути',
  delivered: '✅ Доставлен',
  cancelled: '❌ Отменён',
};

/** Названия тем при создании (scripts/telegram-topics.ts). */
export const CARD_TOPIC_NAMES: Record<CardStatus, string> = {
  cooking: '🔥 Готовится',
  ready: '📦 Готов к доставке',
  on_the_way: '🚗 В пути',
  delivered: '✅ Доставлен',
  cancelled: '❌ Отменён',
};

/** Терминальные статусы: карточка в архиве, кнопок нет (кроме отката-опечатки). */
export function isTerminalCardStatus(status: CardStatus): boolean {
  return status === 'delivered' || status === 'cancelled';
}

/**
 * Статус заказа в БД → тема форума. `new` и `preparing` живут в одной теме:
 * для кухни это одно состояние («в работе»), а лишний переезд = лишнее
 * сообщение и потерянный контекст в ленте.
 */
const ORDER_STATUS_TO_CARD: Record<string, CardStatus> = {
  new: 'cooking',
  preparing: 'cooking',
  ready_for_delivery: 'ready',
  delivering: 'on_the_way',
  completed: 'delivered',
  cancelled: 'cancelled',
};

/** null — статус не отображается карточкой (например, pending_payment-драфт). */
export function cardStatusForOrderStatus(status: unknown): CardStatus | null {
  if (typeof status !== 'string') return null;
  return ORDER_STATUS_TO_CARD[status] ?? null;
}

export interface ForumConfig {
  chatId: string;
  botToken: string;
  /** message_thread_id темы по состоянию карточки. */
  topics: Record<CardStatus, number>;
  /** Статусы, переезд в которые идёт СО звуком (курьеру нужен сигнал). */
  soundStatuses: CardStatus[];
  /** Окно отката ошибочного нажатия у терминальных статусов, мс. */
  undoWindowMs: number;
  /** Ростер курьеров для кнопки «Назначить курьера» (может быть пустым). */
  couriers: string[];
  /** Показывать ли служебный ряд (🖨 чек / ⏳ продлить) под статусными кнопками. */
  utilityButtons: boolean;
}

const DEFAULT_UNDO_WINDOW_MS = 10 * 60_000;

function toTopicId(value: unknown): number | null {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function isTruthy(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const s = String(value ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

/**
 * Конфиг форума или null, если режим не включён / темы не заданы.
 * Вызывающий код обязан трактовать null как «работаем по-старому».
 */
export async function getForumConfig(): Promise<ForumConfig | null> {
  const s = (await getSetting<Record<string, any>>(STORE_SETTINGS_KEY, {})) || {};

  const enabled = isTruthy(s.telegramForumEnabled ?? process.env.TELEGRAM_FORUM_ENABLED);
  if (!enabled) return null;

  const botToken = s.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = String(s.telegramChatId || process.env.TELEGRAM_CHAT_ID || '');
  if (!botToken || !chatId) return null;

  const raw: Record<CardStatus, number | null> = {
    cooking: toTopicId(s.telegramTopicCooking ?? process.env.TELEGRAM_TOPIC_COOKING),
    ready: toTopicId(s.telegramTopicReady ?? process.env.TELEGRAM_TOPIC_READY),
    on_the_way: toTopicId(s.telegramTopicOnTheWay ?? process.env.TELEGRAM_TOPIC_ON_THE_WAY),
    delivered: toTopicId(s.telegramTopicDelivered ?? process.env.TELEGRAM_TOPIC_DELIVERED),
    cancelled: toTopicId(s.telegramTopicCancelled ?? process.env.TELEGRAM_TOPIC_CANCELLED),
  };

  const missing = REQUIRED_TOPICS.filter((status) => raw[status] == null);
  if (missing.length) {
    console.warn(
      `[telegram] режим форума включён, но не заданы темы: ${missing.join(', ')} — работаем по-старому`
    );
    return null;
  }

  // Отменённые заказы по умолчанию уезжают в архивную тему «Доставлен»:
  // отдельная тема для отмен — опция, а не обязательное требование.
  const topics: Record<CardStatus, number> = {
    cooking: raw.cooking!,
    ready: raw.ready!,
    on_the_way: raw.on_the_way!,
    delivered: raw.delivered!,
    cancelled: raw.cancelled ?? raw.delivered!,
  };

  // Со звуком по умолчанию два перехода: «Готов к доставке» (сигнал курьеру)
  // и «Доставлен» (заказ закрыт — это видит менеджер). Отмена звука НЕ даёт,
  // хотя и уезжает в ту же тему, что «Доставлен»: звук привязан к статусу
  // карточки, а не к теме.
  const soundRaw = toList(
    s.telegramCardSoundStatuses ?? process.env.TELEGRAM_CARD_SOUND_STATUSES ?? 'ready,delivered'
  );
  const soundStatuses = soundRaw.filter((v): v is CardStatus =>
    (CARD_STATUSES as readonly string[]).includes(v)
  );

  const undoRaw = Number(
    s.telegramCardUndoWindowMinutes ?? process.env.TELEGRAM_CARD_UNDO_WINDOW_MINUTES ?? NaN
  );

  return {
    chatId,
    botToken,
    topics,
    soundStatuses,
    undoWindowMs:
      Number.isFinite(undoRaw) && undoRaw >= 0 ? undoRaw * 60_000 : DEFAULT_UNDO_WINDOW_MS,
    couriers: toList(s.telegramCouriers ?? process.env.TELEGRAM_COURIERS),
    utilityButtons: !isTruthy(
      s.telegramCardHideUtilityButtons ?? process.env.TELEGRAM_CARD_HIDE_UTILITY_BUTTONS
    ),
  };
}

/** Звук при переезде: тихо везде, кроме «Готов к доставке» (курьеру нужен сигнал). */
export function shouldNotifyOnMove(config: ForumConfig, target: CardStatus): boolean {
  return config.soundStatuses.includes(target);
}
