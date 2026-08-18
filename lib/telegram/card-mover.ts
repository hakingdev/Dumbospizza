/**
 * Переезд карточки заказа между темами форума.
 *
 * Telegram НЕ умеет переносить сообщение в другую тему, поэтому «переезд» — это:
 *   1) sendMessage в новую тему (новый текст + клавиатура под новый статус);
 *   2) запись в order_cards: карточка теперь ЗДЕСЬ;
 *   3) deleteMessage старой карточки.
 *
 * Порядок именно такой. Отправка строго ПЕРВАЯ: пока новая карточка не
 * подтверждена Telegram'ом, старую трогать нельзя — иначе заказ исчезает из
 * группы. Запись в БД стоит между отправкой и удалением осознанно: если процесс
 * умрёт после удаления, но до записи, БД будет указывать на удалённое
 * сообщение — а так в худшем случае в старой теме остаётся дубль, который
 * видно и можно убрать руками. Провал удаления логируется и НЕ откатывает
 * переезд: лучше дубль, чем потерянный заказ.
 *
 * Двойной тап по кнопке защищён двумя рубежами:
 *   - блокировка по заказу в процессе (withOrderLock) — типовой случай, оба
 *     клика прилетают в один инстанс функции;
 *   - CAS-апдейт статуса в БД (store.claimTransition) — настоящий рубеж:
 *     работает и между инстансами Vercel, и между вебхуком и админкой.
 * Если статус в БД уже равен целевому — no-op, никаких сообщений.
 */
import {
  callBotApi,
  isDeleteMissingError,
  isMessageGoneError,
  isNotModifiedError,
  isTopicClosedError,
} from './bot-api';
import {
  CARD_STATUS_LABELS,
  getForumConfig,
  isTerminalCardStatus,
  shouldNotifyOnMove,
  type CardStatus,
  type ForumConfig,
} from './forum';
import {
  getOrderCardStore,
  type CardHistoryEntry,
  type OrderCardRow,
  type OrderCardStore,
} from './card-store';
import {
  enteredStatusAt,
  isUndoWindowOpen,
  keyboardForCard,
  problemLabel,
  renderCardText,
  type InlineKeyboardMarkup,
} from './card-render';
import { escapeHtml, type OrderNotification } from './order-message';
import { isStaleForWorkingDay } from '../orders/working-day';
import { getTelegramOutbox, OUTBOX_PRIORITY, type TelegramOutbox } from './outbox';

/** Всё, что нужно, чтобы нарисовать карточку заказа. */
export interface CardOrderInput {
  /** orders.id — первичный ключ карточки. */
  orderId: string;
  /** Человекочитаемый номер: он лежит в callback_data кнопок. */
  orderNumber: string;
  createdAt?: Date | string | null;
  notification: OrderNotification;
  /**
   * Заказ принят кухней. `false` — он ещё в статусе `new`, и карточка обязана
   * сказать об этом словами: тема у «нового» и «готовится» одна.
   * `undefined` — источник не знает (старые вызовы), считаем принятым.
   */
  accepted?: boolean;
}

export interface SendCardInput {
  threadId: number;
  text: string;
  keyboard: InlineKeyboardMarkup;
  disableNotification: boolean;
  priority?: number;
}

export interface CardTelegramApi {
  send(input: SendCardInput): Promise<number>;
  edit(input: { messageId: number; text: string; keyboard: InlineKeyboardMarkup }): Promise<void>;
  editKeyboard(input: { messageId: number; keyboard: InlineKeyboardMarkup }): Promise<void>;
  /** 'missing' — сообщения уже нет; для переезда это успех. */
  remove(messageId: number): Promise<'deleted' | 'missing'>;
  reopenTopic(threadId: number): Promise<void>;
  /** Короткое служебное сообщение в тему (проблема с доставкой). */
  alert(input: { threadId: number; text: string }): Promise<number>;
}

/** Реализация поверх Bot API + общей очереди исходящих. */
export function createCardApi(
  config: Pick<ForumConfig, 'botToken' | 'chatId'>,
  outbox: TelegramOutbox = getTelegramOutbox(),
  fetchImpl: typeof fetch = fetch
): CardTelegramApi {
  const call = <T>(method: string, payload: Record<string, unknown>, priority: number, label: string) =>
    outbox.enqueue<T>(() => callBotApi<T>(config.botToken, method, payload, fetchImpl), {
      priority,
      label,
    });

  return {
    async send(input) {
      const msg = await call<{ message_id: number }>(
        'sendMessage',
        {
          chat_id: config.chatId,
          message_thread_id: input.threadId,
          text: input.text,
          parse_mode: 'HTML',
          reply_markup: input.keyboard,
          disable_notification: input.disableNotification,
          link_preview_options: { is_disabled: true },
        },
        input.priority ?? OUTBOX_PRIORITY.move,
        'sendMessage'
      );
      return msg.message_id;
    },

    async edit(input) {
      await call(
        'editMessageText',
        {
          chat_id: config.chatId,
          message_id: input.messageId,
          text: input.text,
          parse_mode: 'HTML',
          reply_markup: input.keyboard,
          link_preview_options: { is_disabled: true },
        },
        OUTBOX_PRIORITY.edit,
        'editMessageText'
      );
    },

    async editKeyboard(input) {
      await call(
        'editMessageReplyMarkup',
        {
          chat_id: config.chatId,
          message_id: input.messageId,
          reply_markup: input.keyboard,
        },
        OUTBOX_PRIORITY.edit,
        'editMessageReplyMarkup'
      );
    },

    async remove(messageId) {
      try {
        await call(
          'deleteMessage',
          { chat_id: config.chatId, message_id: messageId },
          OUTBOX_PRIORITY.cleanup,
          'deleteMessage'
        );
        return 'deleted';
      } catch (e) {
        if (isDeleteMissingError(e)) return 'missing';
        throw e;
      }
    },

    async reopenTopic(threadId) {
      await call(
        'reopenForumTopic',
        { chat_id: config.chatId, message_thread_id: threadId },
        OUTBOX_PRIORITY.edit,
        'reopenForumTopic'
      );
    },

    async alert(input) {
      const msg = await call<{ message_id: number }>(
        'sendMessage',
        {
          chat_id: config.chatId,
          message_thread_id: input.threadId,
          text: input.text,
          parse_mode: 'HTML',
          disable_notification: false,
        },
        OUTBOX_PRIORITY.edit,
        'sendMessage(alert)'
      );
      return msg.message_id;
    },
  };
}

// ---------------------------------------------------------------------------
// Блокировка по заказу внутри процесса
// ---------------------------------------------------------------------------

const orderLocks = new Map<string, Promise<unknown>>();

/**
 * Последовательное выполнение операций по одному заказу. Ловит типовой двойной
 * тап (оба клика в одном инстансе функции) ДО похода в БД. Между инстансами
 * страхует CAS в store.claimTransition.
 */
export function withOrderLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = orderLocks.get(key) ?? Promise.resolve();
  // Ошибка предыдущей операции не должна отменять следующую в очереди.
  const run = prev.then(fn, fn);
  const settled = run.then(
    () => {},
    () => {}
  );
  orderLocks.set(key, settled);
  void settled.then(() => {
    if (orderLocks.get(key) === settled) orderLocks.delete(key);
  });
  return run;
}

// ---------------------------------------------------------------------------
// Операции над карточкой
// ---------------------------------------------------------------------------

export interface CardDeps {
  /** undefined — прочитать конфиг; null — форум выключен (для тестов). */
  config?: ForumConfig | null;
  store?: OrderCardStore;
  api?: CardTelegramApi;
  now?: () => Date;
  log?: (...args: any[]) => void;
}

export type MoveReason =
  | 'moved'
  | 'edited'
  | 'noop'
  | 'raced'
  | 'created'
  | 'send_failed'
  | 'disabled'
  /** Заказ прошлой смены, его карточку убрали — воскрешать нечего. */
  | 'stale';

export interface MoveResult {
  ok: boolean;
  reason: MoveReason;
  messageId?: number;
  topicId?: number;
}

interface Resolved {
  config: ForumConfig;
  store: OrderCardStore;
  api: CardTelegramApi;
  now: () => Date;
  log: (...args: any[]) => void;
}

async function resolveDeps(deps: CardDeps): Promise<Resolved | null> {
  const config = deps.config !== undefined ? deps.config : await getForumConfig();
  if (!config) return null;
  return {
    config,
    store: deps.store ?? getOrderCardStore(),
    api: deps.api ?? createCardApi(config),
    now: deps.now ?? (() => new Date()),
    log: deps.log ?? ((...a: any[]) => console.log('[telegram-card]', ...a)),
  };
}

/** Отправка с автолечением закрытой темы: reopenForumTopic → повтор один раз. */
async function sendWithTopicRecovery(
  d: Resolved,
  input: SendCardInput
): Promise<number> {
  try {
    return await d.api.send(input);
  } catch (e) {
    if (!isTopicClosedError(e)) throw e;
    d.log('тема закрыта — открываю и повторяю отправку', { threadId: input.threadId });
    await d.api.reopenTopic(input.threadId);
    return d.api.send(input);
  }
}

function cardText(
  order: CardOrderInput,
  status: CardStatus,
  history: CardHistoryEntry[],
  courier: string | null
): string {
  return renderCardText({
    order: order.notification,
    status,
    statusHistory: history,
    createdAt: order.createdAt,
    courier,
    awaitingAcceptance: order.accepted === false,
  });
}

/**
 * Первая карточка заказа: отправить в тему статуса и запомнить, где она лежит.
 * Используется при поступлении заказа и миграцией активных заказов.
 */
export async function createOrderCard(
  order: CardOrderInput,
  status: CardStatus,
  deps: CardDeps = {}
): Promise<{ messageId: number; topicId: number } | null> {
  const d = await resolveDeps(deps);
  if (!d) return null;

  return withOrderLock(order.orderId, () =>
    createOrderCardUnlocked(d, order, status, {
      // Новый заказ всегда со звуком и вперёд очереди — его ждёт кухня.
      notify: true,
      priority: OUTBOX_PRIORITY.newOrder,
    })
  );
}

/**
 * Полный цикл переноса карточки в тему нового статуса.
 * Идемпотентно: статус в БД уже целевой → no-op, ничего не отправляем.
 */
export async function moveOrderCard(
  order: CardOrderInput,
  target: CardStatus,
  deps: CardDeps = {}
): Promise<MoveResult> {
  const d = await resolveDeps(deps);
  if (!d) return { ok: false, reason: 'disabled' };

  return withOrderLock(order.orderId, async () => {
    const card = await d.store.getByOrderId(order.orderId);

    // Карточки нет: заказ старше форума, либо запись потеряна. Создаём её
    // сразу в целевой теме — это лучше, чем молча оставить заказ без карточки.
    if (!card) {
      // Кроме одного случая: заказ прошедшей смены. Его карточку убрала ночная
      // уборка (lib/telegram/card-cleanup.ts), и «создать в целевой теме»
      // означало бы прислать кухне вчерашний заказ как новую работу — стоит
      // менеджеру закрыть его в админке неделю спустя.
      if (isStaleForWorkingDay(order.createdAt, d.now())) {
        d.log('заказ прошлой смены — карточку не воскрешаю', { order: order.orderNumber, target });
        return { ok: false, reason: 'stale' as const };
      }
      d.log('карточки нет — создаю в целевой теме', { order: order.orderNumber, target });
      const created = await createOrderCardUnlocked(d, order, target);
      return created
        ? { ok: true, reason: 'created' as const, ...created }
        : { ok: false, reason: 'send_failed' as const };
    }

    // Статус карточки тот же — но ТЕКСТ мог измениться.
    //
    // `new` и `preparing` дают одну и ту же карточку «cooking», поэтому приём
    // заказа сюда и попадает. Раньше здесь стоял безусловный noop, и получалось,
    // что кухня приняла заказ и назначила время, а карточка об этом не узнавала
    // никогда: в ней оставалось исходное обещание и подпись «не принят».
    if (card.status === target) {
      const text = cardText(order, target, card.statusHistory, card.courier);
      try {
        await d.api.edit({
          messageId: card.messageId,
          text,
          keyboard: keyboardForCard(card, d.config, d.now()),
        });
      } catch (e) {
        // «message is not modified» — обычный ответ, когда менять нечего.
        if (!isNotModifiedError(e)) {
          d.log('обновление карточки на месте не удалось', (e as Error)?.message);
        }
      }
      return { ok: true, reason: 'noop', messageId: card.messageId, topicId: card.topicId };
    }

    const now = d.now();
    const entry: CardHistoryEntry = { status: target, timestamp: now.toISOString() };

    // CAS: строку получает ровно один из конкурирующих кликов.
    const claimed = await d.store.claimTransition(order.orderId, card.status, target, entry);
    if (!claimed) {
      const fresh = await d.store.getByOrderId(order.orderId);
      if (fresh?.status === target) {
        d.log('перенос уже выполнен параллельным кликом', { order: order.orderNumber, target });
        return { ok: true, reason: 'noop', messageId: fresh.messageId, topicId: fresh.topicId };
      }
      d.log('гонка переноса — статус изменился под нами', { order: order.orderNumber, target });
      return { ok: false, reason: 'raced' };
    }

    const text = cardText(order, target, claimed.statusHistory, claimed.courier);
    const keyboard = keyboardForCard(claimed, d.config, now);
    const targetTopic = d.config.topics[target];

    // Целевая тема совпадает с текущей (new → preparing): переезжать некуда,
    // правим карточку на месте — меньше сообщений, история в теме не рвётся.
    if (targetTopic === card.topicId) {
      try {
        await d.api.edit({ messageId: card.messageId, text, keyboard });
      } catch (e) {
        if (isMessageGoneError(e)) {
          d.log('карточка удалена вручную — пересоздаю', { order: order.orderNumber });
          const created = await createOrderCardUnlocked(d, order, target, {
            history: claimed.statusHistory,
          });
          if (created) return { ok: true, reason: 'moved', ...created };
        } else if (!isNotModifiedError(e)) {
          // Статус в БД уже переведён; невозможность перерисовать текст не
          // повод откатывать заказ — кнопки на карточке останутся прежними.
          d.log('editMessageText не удался', (e as Error)?.message);
        }
      }
      return { ok: true, reason: 'edited', messageId: card.messageId, topicId: card.topicId };
    }

    let messageId: number;
    try {
      messageId = await sendWithTopicRecovery(d, {
        threadId: targetTopic,
        text,
        keyboard,
        disableNotification: !shouldNotifyOnMove(d.config, target),
        priority: OUTBOX_PRIORITY.move,
      });
    } catch (e) {
      // Новая карточка не ушла — старую НЕ трогаем и возвращаем статус карточки.
      d.log('sendMessage не удался — откатываю статус карточки', (e as Error)?.message);
      await d.store
        .restore(order.orderId, card.status, card.statusHistory)
        .catch((err) => d.log('откат статуса карточки не удался', (err as Error)?.message));
      return { ok: false, reason: 'send_failed' };
    }

    await d.store.setMessage(order.orderId, { messageId, topicId: targetTopic });

    // Удаление старой — последним и best-effort (см. шапку файла).
    try {
      const removed = await d.api.remove(card.messageId);
      if (removed === 'missing') {
        d.log('старой карточки уже не было', { order: order.orderNumber, messageId: card.messageId });
      }
    } catch (e) {
      d.log(
        'не удалось удалить старую карточку — остаётся дубль',
        { order: order.orderNumber, messageId: card.messageId },
        (e as Error)?.message
      );
    }

    return { ok: true, reason: 'moved', messageId, topicId: targetTopic };
  });
}

/** Создание карточки БЕЗ взятия блокировки (вызывается изнутри неё). */
async function createOrderCardUnlocked(
  d: Resolved,
  order: CardOrderInput,
  status: CardStatus,
  opts: { history?: CardHistoryEntry[]; notify?: boolean; priority?: number } = {}
): Promise<{ messageId: number; topicId: number } | null> {
  const now = d.now();
  const entries: CardHistoryEntry[] = opts.history?.length
    ? opts.history
    : [{ status, timestamp: (order.createdAt ? new Date(order.createdAt) : now).toISOString() }];
  const topicId = d.config.topics[status];
  const text = cardText(order, status, entries, null);
  const keyboard = keyboardForCard(
    { orderNumber: order.orderNumber, status, statusHistory: entries },
    d.config,
    now
  );

  let messageId: number;
  try {
    messageId = await sendWithTopicRecovery(d, {
      threadId: topicId,
      text,
      keyboard,
      disableNotification: !(opts.notify ?? shouldNotifyOnMove(d.config, status)),
      priority: opts.priority ?? OUTBOX_PRIORITY.move,
    });
  } catch (e) {
    d.log('не удалось создать карточку', (e as Error)?.message);
    return null;
  }

  await d.store.upsert({
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    chatId: d.config.chatId,
    messageId,
    topicId,
    status,
    statusHistory: entries,
  });
  return { messageId, topicId };
}

/**
 * Перерисовать карточку на месте (после смены обещанного времени, назначения
 * курьера и т.п.) — без переезда и без записи истории статусов.
 */
export async function refreshOrderCard(
  order: CardOrderInput,
  deps: CardDeps = {}
): Promise<boolean> {
  const d = await resolveDeps(deps);
  if (!d) return false;

  const card = await d.store.getByOrderId(order.orderId);
  if (!card) return false;

  const text = cardText(order, card.status, card.statusHistory, card.courier);
  const keyboard = keyboardForCard(card, d.config, d.now());
  try {
    await d.api.edit({ messageId: card.messageId, text, keyboard });
    return true;
  } catch (e) {
    if (isNotModifiedError(e)) return true;
    d.log('обновление карточки не удалось', (e as Error)?.message);
    return false;
  }
}

/** Показать/вернуть клавиатуру на карточке (меню курьера, меню проблем, «Назад»). */
export async function setCardKeyboard(
  orderNumber: string,
  keyboard: InlineKeyboardMarkup | null,
  deps: CardDeps = {}
): Promise<boolean> {
  const d = await resolveDeps(deps);
  if (!d) return false;

  const card = await d.store.getByOrderNumber(orderNumber);
  if (!card) return false;

  const markup = keyboard ?? keyboardForCard(card, d.config, d.now());
  try {
    await d.api.editKeyboard({ messageId: card.messageId, keyboard: markup });
    return true;
  } catch (e) {
    if (isNotModifiedError(e)) return true;
    d.log('обновление клавиатуры не удалось', (e as Error)?.message);
    return false;
  }
}

/**
 * Можно ли ещё откатить терминальный статус (ошибочное нажатие «Доставлен»).
 *
 * Кнопка отката рисуется только внутри окна, но карточка не перерисовывается
 * по таймеру — «протухшая» кнопка может провисеть на экране часами. Поэтому
 * срок проверяется ещё раз при клике, до записи статуса заказа.
 */
export async function checkUndoWindow(
  orderNumber: string,
  deps: CardDeps = {}
): Promise<{ allowed: boolean; message?: string }> {
  const d = await resolveDeps(deps);
  if (!d) return { allowed: true };

  const card = await d.store.getByOrderNumber(orderNumber);
  if (!card || !isTerminalCardStatus(card.status)) return { allowed: true };

  const open = isUndoWindowOpen({
    enteredAt: enteredStatusAt(card.statusHistory, card.status),
    undoWindowMs: d.config.undoWindowMs,
    now: d.now(),
  });
  if (open) return { allowed: true };

  const minutes = Math.round(d.config.undoWindowMs / 60_000);
  return {
    allowed: false,
    message: `Заказ #${orderNumber} уже закрыт (${CARD_STATUS_LABELS[card.status]}). Откат возможен только первые ${minutes} мин.`,
  };
}

/** Назначить курьера: запись в карточку + отметка в хронологии. */
export async function assignCardCourier(
  orderNumber: string,
  courier: string,
  deps: CardDeps = {}
): Promise<OrderCardRow | null> {
  const d = await resolveDeps(deps);
  if (!d) return null;

  const card = await d.store.getByOrderNumber(orderNumber);
  if (!card) return null;

  await d.store.setCourier(card.orderId, courier);
  const updated = await d.store.appendHistory(card.orderId, {
    status: 'courier',
    timestamp: d.now().toISOString(),
    note: courier,
  });
  return updated ?? card;
}

/**
 * Проблема с доставкой: отметка в карточке + громкое сообщение в теме.
 * Карточку НЕ переносим — заказ по-прежнему в пути, просто с флагом.
 */
export async function recordDeliveryProblem(
  orderNumber: string,
  code: string,
  deps: CardDeps = {}
): Promise<OrderCardRow | null> {
  const d = await resolveDeps(deps);
  if (!d) return null;

  const card = await d.store.getByOrderNumber(orderNumber);
  if (!card) return null;

  const label = problemLabel(code);
  const updated = await d.store.appendHistory(card.orderId, {
    status: 'problem',
    timestamp: d.now().toISOString(),
    note: label,
  });

  // Правка карточки беззвучна, а проблему на дороге должны увидеть сразу —
  // поэтому отдельным сообщением со звуком в ту же тему.
  try {
    await d.api.alert({
      threadId: card.topicId,
      text: `⚠️ <b>Заказ #${escapeHtml(orderNumber)}: ${escapeHtml(label)}</b>`,
    });
  } catch (e) {
    d.log('оповещение о проблеме доставки не ушло', (e as Error)?.message);
  }

  return updated ?? card;
}
