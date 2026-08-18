// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { cleanupStaleOrderCards } from '../telegram/card-cleanup';
import { moveOrderCard, type CardOrderInput, type CardTelegramApi } from '../telegram/card-mover';
import type { CardHistoryEntry, NewOrderCard, OrderCardRow, OrderCardStore } from '../telegram/card-store';
import type { CardStatus, ForumConfig } from '../telegram/forum';
import { TelegramApiError } from '../telegram/bot-api';

/**
 * Ночная уборка карточек: группа заказов — рабочий стол смены, а не архив.
 *
 * Проверяем ровно то, что может стоить денег: уборка не трогает текущую смену
 * (граница — 01:00 по Берлину, а не полночь), не удаляет строку, пока
 * сообщение в Telegram живо, и не воскрешает вчерашний заказ, если его статус
 * поменяли в админке уже после уборки.
 */

const CONFIG: ForumConfig = {
  chatId: '-1001234567890',
  botToken: 'test-token',
  topics: { cooking: 11, ready: 22, on_the_way: 33, delivered: 44, cancelled: 55 },
  soundStatuses: ['ready', 'delivered'],
  undoWindowMs: 10 * 60_000,
  couriers: [],
  utilityButtons: true,
};

const silent = () => {};

class MemoryCardStore implements OrderCardStore {
  rows = new Map<string, OrderCardRow>();

  add(row: Partial<OrderCardRow> & { orderId: string; createdAt: Date }) {
    this.rows.set(row.orderId, {
      orderNumber: row.orderId,
      chatId: CONFIG.chatId,
      messageId: 1000 + this.rows.size,
      topicId: CONFIG.topics.delivered,
      status: 'delivered',
      courier: null,
      statusHistory: [],
      ...row,
    } as OrderCardRow);
    return this;
  }

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
  async claimTransition(orderId: string, expected: CardStatus, next: CardStatus, entry: CardHistoryEntry) {
    const row = this.rows.get(orderId);
    if (!row || row.status !== expected) return null;
    const updated = { ...row, status: next, statusHistory: [...row.statusHistory, entry] };
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
  async listOlderThan(before: Date, limit: number) {
    return Array.from(this.rows.values())
      .filter((r) => (r.createdAt?.getTime() ?? 0) < before.getTime())
      .sort((a, b) => (a.createdAt!.getTime() ?? 0) - (b.createdAt!.getTime() ?? 0))
      .slice(0, limit);
  }
  async forget(orderId: string) {
    this.rows.delete(orderId);
  }
}

function makeApi(overrides: Partial<CardTelegramApi> = {}) {
  const removed: number[] = [];
  const api: CardTelegramApi & { removed: number[] } = {
    removed,
    async send() {
      throw new Error('send не ожидался');
    },
    async edit() {},
    async editKeyboard() {},
    async remove(messageId) {
      removed.push(messageId);
      return 'deleted';
    },
    async reopenTopic() {},
    async alert() {
      return 1;
    },
    ...overrides,
  } as CardTelegramApi & { removed: number[] };
  return api;
}

// Берлин летом = UTC+2, поэтому 01:00 по Берлину — это 23:00 UTC прошлых суток.
const at = (iso: string) => new Date(iso);

describe('cleanupStaleOrderCards', () => {
  it('убирает карточки прошлой смены и забывает строки', async () => {
    // Уборка в 03:00 по Берлину: заказ вечерней смены — вчерашний, а принятый
    // в 01:30 уже принадлежит новым суткам и обязан уцелеть.
    const store = new MemoryCardStore()
      .add({ orderId: 'вчера-1', createdAt: at('2026-08-18T17:00:00Z') })
      .add({ orderId: 'сегодня-1', createdAt: at('2026-08-18T23:30:00Z') });
    const api = makeApi();

    const result = await cleanupStaleOrderCards({
      config: CONFIG,
      store,
      api,
      now: () => at('2026-08-19T01:00:00Z'),
      log: silent,
    });

    expect(result.scanned).toBe(1);
    expect(result.deleted).toBe(1);
    expect(api.removed).toHaveLength(1);
    expect(await store.getByOrderId('вчера-1')).toBeNull();
    // Сегодняшний заказ на месте: смена ещё идёт.
    expect(await store.getByOrderId('сегодня-1')).not.toBeNull();
  });

  it('заказ в 23:50 принадлежит уходящей смене — в 00:30 его не трогаем', async () => {
    // 21:50 UTC = 23:50 по Берлину; проверяем в 22:30 UTC = 00:30 по Берлину.
    const store = new MemoryCardStore().add({
      orderId: 'поздний',
      createdAt: at('2026-08-18T21:50:00Z'),
    });
    const api = makeApi();

    const during = await cleanupStaleOrderCards({
      config: CONFIG,
      store,
      api,
      now: () => at('2026-08-18T22:30:00Z'),
      log: silent,
    });
    expect(during.scanned).toBe(0);
    expect(await store.getByOrderId('поздний')).not.toBeNull();

    // 23:10 UTC = 01:10 по Берлину — смена сменилась, заказ стал вчерашним.
    const after = await cleanupStaleOrderCards({
      config: CONFIG,
      store,
      api,
      now: () => at('2026-08-18T23:10:00Z'),
      log: silent,
    });
    expect(after.deleted).toBe(1);
    expect(await store.getByOrderId('поздний')).toBeNull();
  });

  it('сообщения уже нет — строку всё равно забываем', async () => {
    const store = new MemoryCardStore().add({ orderId: 'убрали-руками', createdAt: at('2026-08-17T17:00:00Z') });
    const api = makeApi({ async remove() { return 'missing'; } });

    const result = await cleanupStaleOrderCards({
      config: CONFIG,
      store,
      api,
      now: () => at('2026-08-19T01:00:00Z'),
      log: silent,
    });

    expect(result.missing).toBe(1);
    expect(result.deleted).toBe(0);
    expect(await store.getByOrderId('убрали-руками')).toBeNull();
  });

  it('удаление не удалось — строка остаётся до следующего захода', async () => {
    const store = new MemoryCardStore().add({ orderId: 'упрямая', createdAt: at('2026-08-17T17:00:00Z') });
    const api = makeApi({
      async remove() {
        throw new TelegramApiError({ method: 'deleteMessage', code: 400, description: 'Bad Request' });
      },
    });

    const result = await cleanupStaleOrderCards({
      config: CONFIG,
      store,
      api,
      now: () => at('2026-08-19T01:00:00Z'),
      log: silent,
    });

    expect(result.failed).toBe(1);
    expect(result.deleted).toBe(0);
    // Сообщение с кнопками осталось в группе — за ним обязана остаться строка.
    expect(await store.getByOrderId('упрямая')).not.toBeNull();
  });

  it('считает незакрытые карточки прошлой смены отдельно', async () => {
    const store = new MemoryCardStore()
      .add({ orderId: 'закрыт', createdAt: at('2026-08-17T17:00:00Z'), status: 'delivered' })
      .add({ orderId: 'застрял', createdAt: at('2026-08-17T18:00:00Z'), status: 'cooking' });

    const result = await cleanupStaleOrderCards({
      config: CONFIG,
      store,
      api: makeApi(),
      now: () => at('2026-08-19T01:00:00Z'),
      log: silent,
    });

    expect(result.deleted).toBe(2);
    expect(result.unfinished).toBe(1);
  });

  it('останавливается по времени и сообщает, сколько осталось', async () => {
    const store = new MemoryCardStore()
      .add({ orderId: 'a', createdAt: at('2026-08-17T17:00:00Z') })
      .add({ orderId: 'b', createdAt: at('2026-08-17T18:00:00Z') })
      .add({ orderId: 'c', createdAt: at('2026-08-17T19:00:00Z') });

    // Часы двигаются на 10 с за обращение — бюджет кончится после первой карточки.
    let tick = 0;
    const result = await cleanupStaleOrderCards({
      config: CONFIG,
      store,
      api: makeApi(),
      now: () => new Date(at('2026-08-19T01:00:00Z').getTime() + tick++ * 10_000),
      budgetMs: 15_000,
      log: silent,
    });

    expect(result.deleted).toBe(1);
    expect(result.remaining).toBe(2);
    expect(store.rows.size).toBe(2);
  });

  it('форум выключен — уборка молчит', async () => {
    const result = await cleanupStaleOrderCards({ config: null, log: silent });
    expect(result.enabled).toBe(false);
    expect(result.scanned).toBe(0);
  });
});

describe('moveOrderCard после уборки', () => {
  const staleOrder: CardOrderInput = {
    orderId: 'вчерашний',
    orderNumber: '260817001',
    createdAt: at('2026-08-17T17:00:00Z'),
    notification: {
      orderId: '260817001',
      customerName: 'Max Mustermann',
      phoneNumber: '+4915112345678',
      address: 'Hauptstr. 1',
      items: [{ name: 'Pizza Margherita', quantity: 1, price: 9.5 }],
      totalAmount: 9.5,
      subtotal: 9.5,
      deliveryFee: 0,
      paymentMethod: 'Karte',
      deliveryType: 'delivery',
    },
  };

  it('не воскрешает карточку заказа прошлой смены', async () => {
    const store = new MemoryCardStore();
    const sent: number[] = [];
    const api = makeApi({
      async send() {
        sent.push(1);
        return 999;
      },
    });

    const result = await moveOrderCard(staleOrder, 'delivered', {
      config: CONFIG,
      store,
      api,
      now: () => at('2026-08-19T01:00:00Z'),
      log: silent,
    });

    expect(result).toEqual({ ok: false, reason: 'stale' });
    expect(sent).toHaveLength(0);
    expect(store.rows.size).toBe(0);
  });

  it('заказ текущей смены карточку по-прежнему получает', async () => {
    const store = new MemoryCardStore();
    const api = makeApi({ async send() { return 999; } });

    const result = await moveOrderCard(
      { ...staleOrder, createdAt: at('2026-08-18T17:00:00Z') },
      'delivered',
      { config: CONFIG, store, api, now: () => at('2026-08-18T18:00:00Z'), log: silent }
    );

    expect(result.ok).toBe(true);
    expect(result.reason).toBe('created');
    expect(store.rows.size).toBe(1);
  });
});
