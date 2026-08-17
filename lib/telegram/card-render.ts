/**
 * Рендер карточки заказа для темы форума: текст и клавиатура.
 *
 * Два правила, ради которых карточка отличается от обычного сообщения:
 *  1) В шапке — номер, время заказа и текущий статус; внизу — хронология
 *     пройденных статусов (когда приняли, когда отдали курьеру, когда довезли).
 *  2) Кнопки — ТОЛЬКО релевантные текущему статусу. Кнопка «Доставлен» на
 *     карточке, которая ещё готовится, — это способ случайно закрыть заказ.
 *
 * Callback_data статусных кнопок намеренно ТЕ ЖЕ (`status_*`), что у обычного
 * режима: за ними стоит вся существующая обвязка (сохранение статуса, баллы
 * лояльности, WhatsApp клиенту). Форум меняет расположение карточки, а не
 * доменную логику.
 */
import {
  CARD_STATUS_EMOJI,
  CARD_STATUS_LABELS,
  isTerminalCardStatus,
  type CardStatus,
  type ForumConfig,
} from './forum';
import { buildOrderBodyText, escapeHtml, type OrderNotification } from './order-message';
import type { CardHistoryEntry } from './card-store';

const TZ = 'Europe/Berlin';

/** Короткие подписи для хронологии внизу карточки. */
const HISTORY_LABELS: Record<string, string> = {
  cooking: '🔥 Готовится',
  ready: '🚚 Доставляется',
  on_the_way: '🚗 В пути',
  delivered: '✅ Доставлен',
  cancelled: '❌ Отменён',
  problem: '⚠️ Проблема',
  courier: '🧍 Курьер',
};

export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineButton[][];
}

/** Причины «Проблемы с доставкой» — фиксированный список, код уходит в callback_data. */
export const DELIVERY_PROBLEMS: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'noanswer', label: '📵 Не дозвонился' },
  { code: 'absent', label: '🚪 Никого нет дома' },
  { code: 'address', label: '🗺 Неверный адрес' },
  { code: 'refused', label: '🙅 Отказ от заказа' },
  { code: 'other', label: '❓ Другое' },
];

export function problemLabel(code: string): string {
  return DELIVERY_PROBLEMS.find((p) => p.code === code)?.label || '❓ Другое';
}

function formatTime(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** Момент входа карточки в текущий статус — по последней записи истории. */
export function enteredStatusAt(
  history: CardHistoryEntry[],
  status: CardStatus
): Date | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.status === status) {
      const d = new Date(history[i].timestamp);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

export interface CardTextInput {
  order: OrderNotification;
  status: CardStatus;
  statusHistory: CardHistoryEntry[];
  /** Время приёма заказа (orders.created_at). */
  createdAt?: Date | string | null;
  courier?: string | null;
}

/**
 * Текст карточки: шапка (номер, время, статус) → тело заказа → хронология.
 */
export function renderCardText(input: CardTextInput): string {
  const { order, status, statusHistory, courier } = input;

  const placedAt = formatTime(input.createdAt);
  const headerTime = placedAt ? ` · 🕐 ${placedAt}` : '';
  const header =
    `${CARD_STATUS_EMOJI[status]} <b>Заказ #${escapeHtml(order.orderId)}</b>${headerTime}` +
    `\nСтатус: <b>${CARD_STATUS_LABELS[status]}</b>`;

  const courierLine = courier ? `\n🧍 Курьер: ${escapeHtml(courier)}` : '';

  // Последняя незакрытая проблема доставки — сразу под шапкой: оператор должен
  // видеть её раньше состава заказа.
  const lastProblem = [...statusHistory].reverse().find((e) => e.status === 'problem');
  const problemLine = lastProblem
    ? `\n⚠️ <b>Проблема:</b> ${escapeHtml(lastProblem.note || 'без описания')} (${formatTime(
        lastProblem.timestamp
      )})`
    : '';

  const timeline = renderTimeline(statusHistory);

  return [`${header}${courierLine}${problemLine}`, buildOrderBodyText(order), timeline]
    .filter(Boolean)
    .join('\n\n');
}

/** Хронология пройденных статусов: «🔥 Готовится 18:40 · 🚚 Доставляется 18:58». */
export function renderTimeline(history: CardHistoryEntry[]): string {
  const parts = history
    .map((entry) => {
      const label = HISTORY_LABELS[entry.status];
      const time = formatTime(entry.timestamp);
      if (!label || !time) return '';
      return `${label} ${time}`;
    })
    .filter(Boolean);
  if (!parts.length) return '';
  return `🕘 ${parts.join(' · ')}`;
}

export interface CardKeyboardInput {
  orderNumber: string;
  status: CardStatus;
  /** Когда карточка вошла в текущий статус (окно отката у терминальных). */
  enteredAt?: Date | null;
  undoWindowMs: number;
  /** Служебный ряд: 🖨 чек и ⏳ продлить. */
  utilityButtons: boolean;
  now?: Date;
}

/** Окно отката ошибочного нажатия ещё открыто? */
export function isUndoWindowOpen(input: {
  enteredAt?: Date | null;
  undoWindowMs: number;
  now?: Date;
}): boolean {
  if (!input.enteredAt) return false;
  const now = (input.now ?? new Date()).getTime();
  return now - input.enteredAt.getTime() <= input.undoWindowMs;
}

/**
 * Клавиатура строго по текущему статусу.
 *
 * Терминальные статусы (доставлен/отменён) остаются без кнопок — кроме окна
 * отката ошибочного нажатия (по умолчанию 10 минут). Кнопка отката может
 * «пережить» окно (карточка не перерисовывается по таймеру), поэтому срок
 * проверяется ещё раз при клике — см. guardCardCallback в lib/telegram.ts.
 */
export function renderCardKeyboard(input: CardKeyboardInput): InlineKeyboardMarkup {
  const id = input.orderNumber;
  const rows: InlineButton[][] = [];

  switch (input.status) {
    // Терминальные статусы: карточка в архиве, только окно отката опечатки.
    case 'delivered':
      if (isUndoWindowOpen(input)) {
        rows.push([{ text: '↩️ Вернуть в путь', callback_data: `status_delivering_${id}` }]);
      }
      return { inline_keyboard: rows };

    case 'cancelled':
      if (isUndoWindowOpen(input)) {
        rows.push([{ text: '↩️ Вернуть в готовку', callback_data: `status_preparing_${id}` }]);
      }
      return { inline_keyboard: rows };

    case 'cooking':
      // Кнопка названа по теме, а не по статусу («🚚 Доставка», не «Готов к
      // доставке»): у ресторана готовность и передача курьеру — один шаг, и
      // две кнопки под одну тему читались как дубль. Статус за ней прежний —
      // ready_for_delivery, поэтому гость получает корректное «заказ готов».
      rows.push([{ text: '🚚 Доставка', callback_data: `status_ready_${id}` }]);
      // Время готовности, продление, печать чека и отмена живут ТОЛЬКО здесь:
      // всё это операции по заказу, который ещё на кухне. На карточке в пути
      // они лишние — там нужен один жест «доставлен».
      if (input.utilityButtons) {
        rows.push([
          { text: '⏱ Время готовности', callback_data: `eta_menu_${id}` },
          { text: '⏳ Продлить', callback_data: `delay_menu_${id}` },
        ]);
      }
      rows.push([
        ...(input.utilityButtons
          ? [{ text: '🖨 Чек', callback_data: `reprint_${id}` }]
          : []),
        { text: '❌ Отменить', callback_data: `status_cancelled_${id}` },
      ]);
      break;

    case 'ready':
      // Промежуточного «Курьер забрал» здесь нет — из темы «Доставка» заказ
      // закрывают сразу. Статус delivering остаётся достижимым из админки, его
      // клавиатура ниже.
      rows.push([{ text: '✅ Доставлен', callback_data: `status_completed_${id}` }]);
      rows.push([
        { text: '🧍 Назначить курьера', callback_data: `card_cmenu_${id}` },
        { text: '⚠️ Проблема', callback_data: `card_pmenu_${id}` },
      ]);
      rows.push([{ text: '↩️ Вернуть в готовку', callback_data: `status_preparing_${id}` }]);
      break;

    case 'on_the_way':
      rows.push([{ text: '✅ Доставлен', callback_data: `status_completed_${id}` }]);
      rows.push([{ text: '⚠️ Проблема с доставкой', callback_data: `card_pmenu_${id}` }]);
      break;
  }

  return { inline_keyboard: rows };
}

/** Клавиатура из карточки + конфига — самый частый вызов. */
export function keyboardForCard(
  card: { orderNumber: string; status: CardStatus; statusHistory: CardHistoryEntry[] },
  config: Pick<ForumConfig, 'undoWindowMs' | 'utilityButtons'>,
  now = new Date()
): InlineKeyboardMarkup {
  return renderCardKeyboard({
    orderNumber: card.orderNumber,
    status: card.status,
    enteredAt: enteredStatusAt(card.statusHistory, card.status),
    undoWindowMs: config.undoWindowMs,
    utilityButtons: config.utilityButtons,
    now,
  });
}

/** Меню выбора курьера: ростер из настроек + «беру сам» + возврат. */
export function renderCourierKeyboard(
  orderNumber: string,
  couriers: string[]
): InlineKeyboardMarkup {
  const rows: InlineButton[][] = [];
  for (let i = 0; i < couriers.length; i += 2) {
    rows.push(
      couriers.slice(i, i + 2).map((name, j) => ({
        text: `🧍 ${name}`,
        callback_data: `card_courier_${i + j}_${orderNumber}`,
      }))
    );
  }
  rows.push([{ text: '🙋 Я забираю', callback_data: `card_courier_me_${orderNumber}` }]);
  rows.push([{ text: '◀️ Назад', callback_data: `card_back_${orderNumber}` }]);
  return { inline_keyboard: rows };
}

/** Меню причин проблемы с доставкой. */
export function renderProblemKeyboard(orderNumber: string): InlineKeyboardMarkup {
  const rows: InlineButton[][] = [];
  for (let i = 0; i < DELIVERY_PROBLEMS.length; i += 2) {
    rows.push(
      DELIVERY_PROBLEMS.slice(i, i + 2).map((p) => ({
        text: p.label,
        callback_data: `card_problem_${p.code}_${orderNumber}`,
      }))
    );
  }
  rows.push([{ text: '◀️ Назад', callback_data: `card_back_${orderNumber}` }]);
  return { inline_keyboard: rows };
}

// ---------------------------------------------------------------------------
// Разбор callback_data кнопок карточки (префикс card_ — не пересекается с
// status_/eta_/delay_/reprint_ и с ботами ctrl_/plan_)
// ---------------------------------------------------------------------------

export type CardCallback =
  | { action: 'courier_menu'; orderNumber: string }
  | { action: 'courier_set'; value: string; orderNumber: string }
  | { action: 'problem_menu'; orderNumber: string }
  | { action: 'problem_set'; value: string; orderNumber: string }
  | { action: 'back'; orderNumber: string };

/**
 * `card_cmenu_<order>` | `card_courier_<idx|me>_<order>` |
 * `card_pmenu_<order>` | `card_problem_<code>_<order>` | `card_back_<order>`.
 *
 * Делим по ПЕРВОМУ '_' (как parseEtaCallback): orderNumber может содержать '_'.
 */
export function parseCardCallback(data: unknown): CardCallback | null {
  if (typeof data !== 'string' || !data.startsWith('card_')) return null;
  const rest = data.slice('card_'.length);
  const i = rest.indexOf('_');
  if (i <= 0) return null;

  const action = rest.slice(0, i);
  const tail = rest.slice(i + 1);
  if (!tail) return null;

  if (action === 'cmenu') return { action: 'courier_menu', orderNumber: tail };
  if (action === 'pmenu') return { action: 'problem_menu', orderNumber: tail };
  if (action === 'back') return { action: 'back', orderNumber: tail };

  if (action === 'courier' || action === 'problem') {
    const j = tail.indexOf('_');
    if (j <= 0) return null;
    const value = tail.slice(0, j);
    const orderNumber = tail.slice(j + 1);
    if (!value || !orderNumber) return null;
    return action === 'courier'
      ? { action: 'courier_set', value, orderNumber }
      : { action: 'problem_set', value, orderNumber };
  }

  return null;
}
