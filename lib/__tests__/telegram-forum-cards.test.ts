// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  createOrderCard,
  moveOrderCard,
  createCardApi,
  checkUndoWindow,
  type CardOrderInput,
  type CardTelegramApi,
} from '../telegram/card-mover';
import type { CardHistoryEntry, NewOrderCard, OrderCardRow, OrderCardStore } from '../telegram/card-store';
import type { CardStatus, ForumConfig } from '../telegram/forum';
import { TelegramApiError } from '../telegram/bot-api';
import { TelegramOutbox } from '../telegram/outbox';
import {
  parseCardCallback,
  renderCardKeyboard,
  renderCardText,
} from '../telegram/card-render';

/**
 * Карточка заказа в группе-форуме: переезд между темами по статусу.
 *
 * Главное, что проверяем, — переезд НЕ теряет заказ и НЕ плодит дубли:
 * двойной тап даёт одну карточку и один переход, удалённая вручную старая
 * карточка не ломает перенос, 429 от Telegram переигрывается очередью, а
 * упавшая отправка откатывает статус и оставляет старую карточку на месте.
 */

const CONFIG: ForumConfig = {
  chatId: '-1001234567890',
  botToken: 'test-token',
  topics: { cooking: 11, ready: 22, on_the_way: 33, delivered: 44, cancelled: 55 },
  soundStatuses: ['ready', 'delivered'],
  undoWindowMs: 10 * 60_000,
  couriers: ['Иван', 'Пётр'],
  utilityButtons: true,
};

const ORDER: CardOrderInput = {
  orderId: 'ord_1',
  orderNumber: '260620001',
  createdAt: new Date('2026-06-20T16:40:00Z'),
  notification: {
    orderId: '260620001',
    customerName: 'Max Mustermann',
    phoneNumber: '+4915112345678',
    address: 'Hauptstr. 1, 97688 Bad Kissingen',
    items: [{ name: 'Pizza Margherita', quantity: 2, price: 9.5 }],
    totalAmount: 21.9,
    subtotal: 19,
    deliveryFee: 2.9,
    paymentMethod: 'Karte',
    deliveryType: 'delivery',
  },
};

// --- in-memory стор с теми же CAS-семантиками, что у Postgres --------------

class MemoryCardStore implements OrderCardStore {
  rows = new Map<string, OrderCardRow>();

  async getByOrderNumber(orderNumber: string) {
    return Array.from(this.rows.values()).find((r) => r.orderNumber === orderNumber) ?? null;
  }
  async getByOrderId(orderId: string) {
    return this.rows.get(orderId) ?? null;
  }
  async upsert(card: NewOrderCard) {
    const row: OrderCardRow = { ...card, courier: null };
    this.rows.set(card.orderId, row);
    return row;
  }
  /** Атомарно: между проверкой и записью нет await — как один UPDATE ... WHERE. */
  async claimTransition(
    orderId: string,
    expected: CardStatus,
    next: CardStatus,
    entry: CardHistoryEntry
  ) {
    const row = this.rows.get(orderId);
    if (!row || row.status !== expected) return null;
    const updated: OrderCardRow = {
      ...row,
      status: next,
      statusHistory: [...row.statusHistory, entry],
    };
    this.rows.set(orderId, updated);
    return updated;
  }
  async restore(orderId: string, status: CardStatus, history: CardHistoryEntry[]) {
    const row = this.rows.get(orderId);
    if (row) this.rows.set(orderId, { ...row, status, statusHistory: history });
  }
  async setMessage(orderId: string, message: { messageId: number; topicId: number }) {
    const row = this.rows.get(orderId);
    if (row) this.rows.set(orderId, { ...row, ...message });
  }
  async setCourier(orderId: string, courier: string) {
    const row = this.rows.get(orderId);
    if (!row) return null;
    const updated = { ...row, courier };
    this.rows.set(orderId, updated);
    return updated;
  }
  async appendHistory(orderId: string, entry: CardHistoryEntry) {
    const row = this.rows.get(orderId);
    if (!row) return null;
    const updated = { ...row, statusHistory: [...row.statusHistory, entry] };
    this.rows.set(orderId, updated);
    return updated;
  }
}

/** Общий счётчик message_id: у разных «инстансов» бота id не должны совпадать. */
let nextMessageId = 1000;

function makeApi(overrides: Partial<CardTelegramApi> = {}) {
  const sent: Array<{ threadId: number; disableNotification: boolean; text: string }> = [];
  const deleted: number[] = [];
  const edited: number[] = [];
  const reopened: number[] = [];

  const api: CardTelegramApi = {
    async send(input) {
      sent.push({
        threadId: input.threadId,
        disableNotification: input.disableNotification,
        text: input.text,
      });
      return ++nextMessageId;
    },
    async edit(input) {
      edited.push(input.messageId);
    },
    async editKeyboard(input) {
      edited.push(input.messageId);
    },
    async remove(messageId) {
      deleted.push(messageId);
      return 'deleted';
    },
    async reopenTopic(threadId) {
      reopened.push(threadId);
    },
    async alert() {
      return ++nextMessageId;
    },
    ...overrides,
  };

  return { api, sent, deleted, edited, reopened };
}

const silent = () => {};

async function seedCard(store: MemoryCardStore, status: CardStatus = 'cooking') {
  const { api } = makeApi();
  await createOrderCard(ORDER, status, { config: CONFIG, store, api, log: silent });
  return store.rows.get(ORDER.orderId)!;
}

// --- переезд ---------------------------------------------------------------

describe('moveOrderCard', () => {
  it('переносит карточку: сначала отправка в новую тему, потом удаление старой', async () => {
    const store = new MemoryCardStore();
    const card = await seedCard(store);
    const { api, sent, deleted } = makeApi();

    const result = await moveOrderCard(ORDER, 'ready', { config: CONFIG, store, api, log: silent });

    expect(result).toMatchObject({ ok: true, reason: 'moved', topicId: CONFIG.topics.ready });
    expect(sent).toHaveLength(1);
    expect(sent[0].threadId).toBe(CONFIG.topics.ready);
    expect(deleted).toEqual([card.messageId]);

    const row = store.rows.get(ORDER.orderId)!;
    expect(row.status).toBe('ready');
    expect(row.topicId).toBe(CONFIG.topics.ready);
    expect(row.messageId).not.toBe(card.messageId);
    expect(row.statusHistory.map((e) => e.status)).toEqual(['cooking', 'ready']);
  });

  it('двойной клик по кнопке статуса → одна карточка и один переход', async () => {
    const store = new MemoryCardStore();
    await seedCard(store);
    const { api, sent, deleted } = makeApi();

    const [first, second] = await Promise.all([
      moveOrderCard(ORDER, 'ready', { config: CONFIG, store, api, log: silent }),
      moveOrderCard(ORDER, 'ready', { config: CONFIG, store, api, log: silent }),
    ]);

    expect(sent).toHaveLength(1);
    expect(deleted).toHaveLength(1);
    expect([first.reason, second.reason].sort()).toEqual(['moved', 'noop']);

    const row = store.rows.get(ORDER.orderId)!;
    expect(row.statusHistory.filter((e) => e.status === 'ready')).toHaveLength(1);
  });

  it('CAS: перевод, выигранный другим инстансом, не отправляет вторую карточку', async () => {
    const store = new MemoryCardStore();
    await seedCard(store);
    const { api, sent } = makeApi();

    // Имитируем гонку между инстансами Vercel: пока мы читали карточку,
    // соседний инстанс уже перевёл её в 'ready' — claim вернёт null.
    const raced: OrderCardStore = {
      ...store,
      getByOrderId: (id: string) => store.getByOrderId(id),
      getByOrderNumber: (n: string) => store.getByOrderNumber(n),
      claimTransition: async (orderId, _expected, next, entry) => {
        await store.claimTransition(orderId, 'cooking', next, entry);
        return null; // строку забрал «другой инстанс»
      },
      restore: (...args) => store.restore(...args),
      setMessage: (...args) => store.setMessage(...args),
      setCourier: (...args) => store.setCourier(...args),
      appendHistory: (...args) => store.appendHistory(...args),
      upsert: (...args) => store.upsert(...args),
    };

    const result = await moveOrderCard(ORDER, 'ready', {
      config: CONFIG,
      store: raced,
      api,
      log: silent,
    });

    expect(result).toMatchObject({ ok: true, reason: 'noop' });
    expect(sent).toHaveLength(0);
  });

  it('статус в БД уже целевой → no-op без единого обращения к Telegram', async () => {
    const store = new MemoryCardStore();
    await seedCard(store, 'ready');
    const { api, sent, deleted, edited } = makeApi();

    const result = await moveOrderCard(ORDER, 'ready', { config: CONFIG, store, api, log: silent });

    expect(result.reason).toBe('noop');
    expect([...sent, ...deleted, ...edited]).toHaveLength(0);
  });

  it('старую карточку удалили вручную → перенос доводится до конца', async () => {
    const store = new MemoryCardStore();
    await seedCard(store);
    const { api, sent } = makeApi({
      async remove() {
        throw new TelegramApiError({
          method: 'deleteMessage',
          code: 400,
          description: 'Bad Request: message to delete not found',
        });
      },
    });

    const result = await moveOrderCard(ORDER, 'ready', { config: CONFIG, store, api, log: silent });

    expect(result).toMatchObject({ ok: true, reason: 'moved' });
    expect(sent).toHaveLength(1);
    const row = store.rows.get(ORDER.orderId)!;
    expect(row.status).toBe('ready');
    expect(row.topicId).toBe(CONFIG.topics.ready);
  });

  it('карточку удалили вручную, правка на месте → карточка пересоздаётся', async () => {
    const store = new MemoryCardStore();
    const card = await seedCard(store);
    const { api, sent } = makeApi({
      async edit() {
        throw new TelegramApiError({
          method: 'editMessageText',
          code: 400,
          description: 'Bad Request: message to edit not found',
        });
      },
    });

    const sameTopic: ForumConfig = {
      ...CONFIG,
      topics: { ...CONFIG.topics, ready: CONFIG.topics.cooking },
    };
    const result = await moveOrderCard(ORDER, 'ready', {
      config: sameTopic,
      store,
      api,
      log: silent,
    });

    expect(result.ok).toBe(true);
    expect(sent).toHaveLength(1);
    const row = store.rows.get(ORDER.orderId)!;
    expect(row.messageId).not.toBe(card.messageId);
    expect(row.status).toBe('ready');
    // Хронология переезда не потерялась при пересоздании.
    expect(row.statusHistory.map((e) => e.status)).toEqual(['cooking', 'ready']);
  });

  it('sendMessage упал → старая карточка НЕ удалена, статус откатан', async () => {
    const store = new MemoryCardStore();
    const card = await seedCard(store);
    const { api, deleted } = makeApi({
      async send() {
        throw new TelegramApiError({
          method: 'sendMessage',
          code: 400,
          description: 'Bad Request: chat not found',
        });
      },
    });

    const result = await moveOrderCard(ORDER, 'ready', { config: CONFIG, store, api, log: silent });

    expect(result).toEqual({ ok: false, reason: 'send_failed' });
    expect(deleted).toEqual([]);

    const row = store.rows.get(ORDER.orderId)!;
    expect(row.status).toBe('cooking');
    expect(row.messageId).toBe(card.messageId);
    expect(row.statusHistory.map((e) => e.status)).toEqual(['cooking']);
  });

  it('закрытая тема → reopenForumTopic и повтор отправки', async () => {
    const store = new MemoryCardStore();
    await seedCard(store);
    let firstAttempt = true;
    const { api, sent, reopened } = makeApi({
      async send(input) {
        if (firstAttempt) {
          firstAttempt = false;
          throw new TelegramApiError({
            method: 'sendMessage',
            code: 400,
            description: 'Bad Request: TOPIC_CLOSED',
          });
        }
        sent.push({
          threadId: input.threadId,
          disableNotification: input.disableNotification,
          text: input.text,
        });
        return 2001;
      },
    });

    const result = await moveOrderCard(ORDER, 'ready', { config: CONFIG, store, api, log: silent });

    expect(reopened).toEqual([CONFIG.topics.ready]);
    expect(result).toMatchObject({ ok: true, reason: 'moved', messageId: 2001 });
    expect(sent).toHaveLength(1);
  });

  it('целевая тема совпадает с текущей → правка на месте, без переезда', async () => {
    const store = new MemoryCardStore();
    const card = await seedCard(store, 'cooking');
    const { api, sent, deleted, edited } = makeApi();

    // cancelled по умолчанию делит тему с delivered — тот же случай, что new→preparing.
    const sameTopic: ForumConfig = {
      ...CONFIG,
      topics: { ...CONFIG.topics, ready: CONFIG.topics.cooking },
    };
    const result = await moveOrderCard(ORDER, 'ready', {
      config: sameTopic,
      store,
      api,
      log: silent,
    });

    expect(result).toMatchObject({ ok: true, reason: 'edited' });
    expect(sent).toEqual([]);
    expect(deleted).toEqual([]);
    expect(edited).toEqual([card.messageId]);
    expect(store.rows.get(ORDER.orderId)!.status).toBe('ready');
  });

  it('откат ready → cooking работает и сохраняет хронологию', async () => {
    const store = new MemoryCardStore();
    await seedCard(store);
    const { api } = makeApi();

    await moveOrderCard(ORDER, 'ready', { config: CONFIG, store, api, log: silent });
    const back = await moveOrderCard(ORDER, 'cooking', { config: CONFIG, store, api, log: silent });

    expect(back).toMatchObject({ ok: true, reason: 'moved', topicId: CONFIG.topics.cooking });
    const row = store.rows.get(ORDER.orderId)!;
    expect(row.status).toBe('cooking');
    expect(row.topicId).toBe(CONFIG.topics.cooking);
    // История не переписывается и не теряется: видно, что заказ вернули.
    expect(row.statusHistory.map((e) => e.status)).toEqual(['cooking', 'ready', 'cooking']);
  });

  it('карточки нет (заказ старше форума) → создаётся сразу в целевой теме', async () => {
    const store = new MemoryCardStore();
    const { api, sent } = makeApi();

    const result = await moveOrderCard(ORDER, 'on_the_way', {
      config: CONFIG,
      store,
      api,
      log: silent,
    });

    expect(result.reason).toBe('created');
    expect(sent[0].threadId).toBe(CONFIG.topics.on_the_way);
    expect(store.rows.get(ORDER.orderId)!.status).toBe('on_the_way');
  });

  it('форум выключен → ничего не делает', async () => {
    const store = new MemoryCardStore();
    const { api, sent } = makeApi();
    const result = await moveOrderCard(ORDER, 'ready', {
      config: null,
      store,
      api,
      log: silent,
    });
    expect(result).toEqual({ ok: false, reason: 'disabled' });
    expect(sent).toEqual([]);
  });
});

// --- уведомления -----------------------------------------------------------

describe('звук уведомлений', () => {
  it('«Готов» и «Доставлен» — со звуком, промежуточные переезды тихие', async () => {
    const store = new MemoryCardStore();
    await seedCard(store);
    const { api, sent } = makeApi();

    await moveOrderCard(ORDER, 'ready', { config: CONFIG, store, api, log: silent });
    await moveOrderCard(ORDER, 'on_the_way', { config: CONFIG, store, api, log: silent });
    await moveOrderCard(ORDER, 'delivered', { config: CONFIG, store, api, log: silent });

    expect(sent.map((s) => s.disableNotification)).toEqual([false, true, false]);
  });

  it('отмена уходит молча, хотя лежит в теме «Доставлен»', async () => {
    const store = new MemoryCardStore();
    await seedCard(store);
    const { api, sent } = makeApi();

    await moveOrderCard(ORDER, 'cancelled', { config: CONFIG, store, api, log: silent });

    expect(sent).toHaveLength(1);
    expect(sent[0].threadId).toBe(CONFIG.topics.cancelled);
    expect(sent[0].disableNotification).toBe(true);
  });
});

// --- очередь и 429 ---------------------------------------------------------

describe('очередь исходящих', () => {
  it('429 от Telegram → пауза retry_after и заказ доезжает до нужной темы', async () => {
    const store = new MemoryCardStore();
    const seeded = await seedCard(store);

    const slept: number[] = [];
    const outbox = new TelegramOutbox({
      minIntervalMs: 0,
      sleep: async (ms) => {
        slept.push(ms);
      },
      log: silent,
    });

    const fetchMock = vi.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      if (body.text && fetchMock.mock.calls.length === 1) {
        return {
          json: async () => ({
            ok: false,
            error_code: 429,
            description: 'Too Many Requests: retry after 3',
            parameters: { retry_after: 3 },
          }),
        } as any;
      }
      return {
        json: async () => ({ ok: true, result: { message_id: 777 } }),
      } as any;
    });

    const api = createCardApi(CONFIG, outbox, fetchMock as unknown as typeof fetch);
    const result = await moveOrderCard(ORDER, 'ready', {
      config: CONFIG,
      store,
      api,
      log: silent,
    });

    expect(result).toMatchObject({ ok: true, reason: 'moved', topicId: CONFIG.topics.ready });
    // Ждали ровно столько, сколько потребовал Telegram.
    expect(slept).toContain(3000);

    const row = store.rows.get(ORDER.orderId)!;
    expect(row.topicId).toBe(CONFIG.topics.ready);
    expect(row.messageId).not.toBe(seeded.messageId);
    // sendMessage (429) → sendMessage (ok) → deleteMessage
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('новый заказ обгоняет переезды в очереди', async () => {
    const order: string[] = [];
    const outbox = new TelegramOutbox({ minIntervalMs: 0, sleep: async () => {}, log: silent });

    // Первая задача занимает очередь, пока в неё встают остальные.
    const gate = outbox.enqueue(async () => {
      order.push('gate');
    }, { priority: 0 });

    const moves = [
      outbox.enqueue(async () => { order.push('move-1'); }, { priority: 10 }),
      outbox.enqueue(async () => { order.push('move-2'); }, { priority: 10 }),
    ];
    const fresh = outbox.enqueue(async () => { order.push('new-order'); }, { priority: 0 });

    await Promise.all([gate, ...moves, fresh]);
    expect(order).toEqual(['gate', 'new-order', 'move-1', 'move-2']);
  });
});

// --- окно отката -----------------------------------------------------------

describe('окно отката терминального статуса', () => {
  it('внутри окна откат разрешён, после — нет', async () => {
    const store = new MemoryCardStore();
    await seedCard(store);
    const { api } = makeApi();

    const deliveredAt = new Date('2026-06-20T18:00:00Z');
    await moveOrderCard(ORDER, 'delivered', {
      config: CONFIG,
      store,
      api,
      log: silent,
      now: () => deliveredAt,
    });

    const inside = await checkUndoWindow(ORDER.orderNumber, {
      config: CONFIG,
      store,
      api,
      now: () => new Date(deliveredAt.getTime() + 5 * 60_000),
    });
    expect(inside.allowed).toBe(true);

    const outside = await checkUndoWindow(ORDER.orderNumber, {
      config: CONFIG,
      store,
      api,
      now: () => new Date(deliveredAt.getTime() + 11 * 60_000),
    });
    expect(outside.allowed).toBe(false);
    expect(outside.message).toContain('10 мин');
  });

  it('нетерминальный статус откатывается без ограничения по времени', async () => {
    const store = new MemoryCardStore();
    await seedCard(store, 'ready');
    const { api } = makeApi();
    const check = await checkUndoWindow(ORDER.orderNumber, {
      config: CONFIG,
      store,
      api,
      now: () => new Date('2027-01-01T00:00:00Z'),
    });
    expect(check.allowed).toBe(true);
  });
});

// --- рендер ----------------------------------------------------------------

describe('renderCardKeyboard', () => {
  const base = { orderNumber: '260620001', undoWindowMs: 10 * 60_000, utilityButtons: false };
  const texts = (status: CardStatus, extra: Record<string, unknown> = {}) =>
    renderCardKeyboard({ ...base, status, ...extra }).inline_keyboard.flat().map((b) => b.text);

  it('кнопки только релевантные текущему статусу', () => {
    expect(texts('cooking')).toEqual(['🚚 Доставка', '❌ Отменить']);
    expect(texts('ready')).toEqual([
      '✅ Доставлен',
      '🧍 Назначить курьера',
      '⚠️ Проблема',
      '↩️ Вернуть в готовку',
    ]);
    expect(texts('on_the_way')).toEqual(['✅ Доставлен', '⚠️ Проблема с доставкой']);
  });

  it('время/продление/чек и отмена — только на карточке «Готовится»', () => {
    const withUtility = (status: CardStatus) =>
      renderCardKeyboard({ ...base, status, utilityButtons: true })
        .inline_keyboard.flat()
        .map((b) => b.text);

    expect(withUtility('cooking')).toEqual([
      '🚚 Доставка',
      '⏱ Время готовности',
      '⏳ Продлить',
      '🖨 Чек',
      '❌ Отменить',
    ]);
    for (const status of ['ready', 'on_the_way'] as CardStatus[]) {
      const labels = withUtility(status).join(' ');
      expect(labels).not.toContain('Время готовности');
      expect(labels).not.toContain('Продлить');
      expect(labels).not.toContain('Чек');
      expect(labels).not.toContain('Отменить');
    }
  });

  it('промежуточного «Курьер забрал» больше нет ни на одной карточке', () => {
    for (const status of ['cooking', 'ready', 'on_the_way'] as CardStatus[]) {
      expect(texts(status).join(' ')).not.toContain('Курьер забрал');
    }
    // Статус delivering остаётся достижимым из админки — своя клавиатура жива.
    expect(texts('on_the_way')).toContain('✅ Доставлен');
  });

  it('доставленный заказ: без кнопок после окна отката', () => {
    const now = new Date('2026-06-20T18:30:00Z');
    expect(texts('delivered', { enteredAt: new Date('2026-06-20T18:25:00Z'), now })).toEqual([
      '↩️ Вернуть в путь',
    ]);
    expect(texts('delivered', { enteredAt: new Date('2026-06-20T18:00:00Z'), now })).toEqual([]);
    expect(texts('delivered')).toEqual([]);
  });

  it('статусные кнопки используют существующие callback_data', () => {
    const buttons = renderCardKeyboard({
      ...base,
      status: 'cooking',
      utilityButtons: true,
    }).inline_keyboard.flat();
    expect(buttons.map((b) => b.callback_data)).toEqual([
      // «🚚 Доставка» — это по-прежнему переход в ready_for_delivery: гость
      // получает «заказ готов», а не преждевременное «в пути».
      'status_ready_260620001',
      'eta_menu_260620001',
      'delay_menu_260620001',
      'reprint_260620001',
      'status_cancelled_260620001',
    ]);
  });
});

describe('renderCardText', () => {
  it('шапка со статусом и хронология пройденных статусов', () => {
    const text = renderCardText({
      order: ORDER.notification,
      status: 'on_the_way',
      createdAt: ORDER.createdAt,
      courier: 'Иван',
      statusHistory: [
        { status: 'cooking', timestamp: '2026-06-20T16:40:00Z' },
        { status: 'ready', timestamp: '2026-06-20T16:58:00Z' },
        { status: 'on_the_way', timestamp: '2026-06-20T17:03:00Z' },
      ],
    });

    expect(text).toContain('<b>Заказ #260620001</b>');
    expect(text).toContain('Статус: <b>🚗 В пути</b>');
    expect(text).toContain('🧍 Курьер: Иван');
    // Время в Europe/Berlin (UTC+2 летом)
    expect(text).toContain('🔥 Готовится 18:40');
    expect(text).toContain('📦 Готов 18:58');
    expect(text).toContain('🚗 В пути 19:03');
    // Тело заказа осталось прежним
    expect(text).toContain('2x Pizza Margherita');
    expect(text).toContain('💰 <b>Итого: 21.90 €</b>');
  });

  it('проблема с доставкой видна в шапке', () => {
    const text = renderCardText({
      order: ORDER.notification,
      status: 'on_the_way',
      createdAt: ORDER.createdAt,
      statusHistory: [
        { status: 'on_the_way', timestamp: '2026-06-20T17:03:00Z' },
        { status: 'problem', timestamp: '2026-06-20T17:12:00Z', note: '📵 Не дозвонился' },
      ],
    });
    expect(text).toContain('⚠️ <b>Проблема:</b> 📵 Не дозвонился (19:12)');
  });
});

describe('parseCardCallback', () => {
  it('разбирает кнопки карточки', () => {
    expect(parseCardCallback('card_cmenu_260620001')).toEqual({
      action: 'courier_menu',
      orderNumber: '260620001',
    });
    expect(parseCardCallback('card_courier_1_260620001')).toEqual({
      action: 'courier_set',
      value: '1',
      orderNumber: '260620001',
    });
    expect(parseCardCallback('card_courier_me_2606_2000_1')).toEqual({
      action: 'courier_set',
      value: 'me',
      orderNumber: '2606_2000_1',
    });
    expect(parseCardCallback('card_problem_noanswer_260620001')).toEqual({
      action: 'problem_set',
      value: 'noanswer',
      orderNumber: '260620001',
    });
    expect(parseCardCallback('card_back_260620001')).toEqual({
      action: 'back',
      orderNumber: '260620001',
    });
  });

  it('чужие и битые callback_data → null', () => {
    expect(parseCardCallback('status_ready_1')).toBeNull();
    expect(parseCardCallback('card_')).toBeNull();
    expect(parseCardCallback('card_courier_1')).toBeNull();
    expect(parseCardCallback('card_bogus_1')).toBeNull();
    expect(parseCardCallback(undefined)).toBeNull();
  });
});
