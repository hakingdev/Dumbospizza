/**
 * Хранилище карточек заказов в форуме (таблица order_cards).
 *
 * Ключевая операция — claimTransition: ОДИН guarded UPDATE вида
 * `WHERE order_id = ? AND status = ожидаемый`. Из двух одновременных кликов по
 * кнопке статуса строку получает ровно один вызов, второму возвращается null —
 * значит, отправлять новую карточку он не имеет права. Никакого
 * read-then-write: тот же приём, что у claim'а печати (lib/orders/print-queue.ts)
 * и у промоута оплаченного драфта (lib/orders/payment-draft.ts).
 *
 * Стор инъектируется в тестах (setOrderCardStoreForTests) — движок переезда
 * ничего не знает ни о Postgres, ни о drizzle.
 */
import { and, asc, eq, lt, sql } from 'drizzle-orm';
import db from '../db/client';
import { orderCards, orders } from '../db/schema';
import type { CardStatus } from './forum';

export interface CardHistoryEntry {
  status: string;
  /** ISO-строка: карточка рендерится в разных часовых поясах, храним UTC. */
  timestamp: string;
  /** Пометка события (например, причина проблемы с доставкой). */
  note?: string;
}

export interface OrderCardRow {
  orderId: string;
  orderNumber: string;
  chatId: string;
  messageId: number;
  topicId: number;
  status: CardStatus;
  courier: string | null;
  statusHistory: CardHistoryEntry[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface NewOrderCard {
  orderId: string;
  orderNumber: string;
  chatId: string;
  messageId: number;
  topicId: number;
  status: CardStatus;
  statusHistory: CardHistoryEntry[];
}

export interface OrderCardStore {
  getByOrderNumber(orderNumber: string): Promise<OrderCardRow | null>;
  getByOrderId(orderId: string): Promise<OrderCardRow | null>;
  /** Создать/пересоздать карточку заказа (повторный заказ-номер невозможен). */
  upsert(card: NewOrderCard): Promise<OrderCardRow>;
  /**
   * CAS-переход статуса. Возвращает обновлённую строку, если статус в БД был
   * ровно `expected`; null — гонка (кто-то уже перевёл) или карточки нет.
   */
  claimTransition(
    orderId: string,
    expected: CardStatus,
    next: CardStatus,
    entry: CardHistoryEntry
  ): Promise<OrderCardRow | null>;
  /** Откат неудавшегося переезда: вернуть статус и историю как было. */
  restore(orderId: string, status: CardStatus, history: CardHistoryEntry[]): Promise<void>;
  /** После успешной отправки новой карточки: куда теперь смотреть. */
  setMessage(orderId: string, message: { messageId: number; topicId: number }): Promise<void>;
  setCourier(orderId: string, courier: string): Promise<OrderCardRow | null>;
  appendHistory(orderId: string, entry: CardHistoryEntry): Promise<OrderCardRow | null>;
  /**
   * Карточки, созданные раньше `before` — работа прошедших смен.
   * Отдаются от старых к новым: если лимит обрежет выборку, уйдёт сначала то,
   * что дольше всех мозолит глаза.
   */
  listOlderThan(before: Date, limit: number): Promise<OrderCardRow[]>;
  /** Забыть карточку: сообщения в Telegram больше нет, строке не на что указывать. */
  forget(orderId: string): Promise<void>;
}

type DbExecutor = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>;

function toRow(row: any): OrderCardRow | null {
  if (!row) return null;
  return {
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    chatId: String(row.chatId),
    messageId: Number(row.messageId),
    topicId: Number(row.topicId),
    status: row.status as CardStatus,
    courier: row.courier ?? null,
    statusHistory: Array.isArray(row.statusHistory) ? row.statusHistory : [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const historyJson = (entries: CardHistoryEntry[]) => JSON.stringify(entries);

class DrizzleOrderCardStore implements OrderCardStore {
  constructor(private readonly dbx: DbExecutor = db) {}

  async getByOrderNumber(orderNumber: string): Promise<OrderCardRow | null> {
    const rows = await this.dbx
      .select()
      .from(orderCards)
      .where(eq(orderCards.orderNumber, orderNumber))
      .limit(1);
    return toRow(rows[0]);
  }

  async getByOrderId(orderId: string): Promise<OrderCardRow | null> {
    const rows = await this.dbx
      .select()
      .from(orderCards)
      .where(eq(orderCards.orderId, orderId))
      .limit(1);
    return toRow(rows[0]);
  }

  async upsert(card: NewOrderCard): Promise<OrderCardRow> {
    const rows = await this.dbx
      .insert(orderCards)
      .values({
        orderId: card.orderId,
        orderNumber: card.orderNumber,
        chatId: card.chatId,
        messageId: card.messageId,
        topicId: card.topicId,
        status: card.status,
        statusHistory: card.statusHistory,
      })
      .onConflictDoUpdate({
        target: orderCards.orderId,
        set: {
          orderNumber: card.orderNumber,
          chatId: card.chatId,
          messageId: card.messageId,
          topicId: card.topicId,
          status: card.status,
          statusHistory: card.statusHistory,
          updatedAt: new Date(),
        },
      })
      .returning();
    await this.syncOrderMessageId(card.orderId, card.messageId);
    return toRow(rows[0])!;
  }

  async claimTransition(
    orderId: string,
    expected: CardStatus,
    next: CardStatus,
    entry: CardHistoryEntry
  ): Promise<OrderCardRow | null> {
    const rows = await this.dbx
      .update(orderCards)
      .set({
        status: next,
        statusHistory: sql`${orderCards.statusHistory} || ${historyJson([entry])}::jsonb`,
        updatedAt: new Date(),
      })
      .where(and(eq(orderCards.orderId, orderId), eq(orderCards.status, expected)))
      .returning();
    return toRow(rows[0]);
  }

  async restore(orderId: string, status: CardStatus, history: CardHistoryEntry[]): Promise<void> {
    await this.dbx
      .update(orderCards)
      .set({ status, statusHistory: history, updatedAt: new Date() })
      .where(eq(orderCards.orderId, orderId));
  }

  async setMessage(
    orderId: string,
    message: { messageId: number; topicId: number }
  ): Promise<void> {
    await this.dbx
      .update(orderCards)
      .set({ messageId: message.messageId, topicId: message.topicId, updatedAt: new Date() })
      .where(eq(orderCards.orderId, orderId));
    await this.syncOrderMessageId(orderId, message.messageId);
  }

  async setCourier(orderId: string, courier: string): Promise<OrderCardRow | null> {
    const rows = await this.dbx
      .update(orderCards)
      .set({ courier, updatedAt: new Date() })
      .where(eq(orderCards.orderId, orderId))
      .returning();
    return toRow(rows[0]);
  }

  async appendHistory(orderId: string, entry: CardHistoryEntry): Promise<OrderCardRow | null> {
    const rows = await this.dbx
      .update(orderCards)
      .set({
        statusHistory: sql`${orderCards.statusHistory} || ${historyJson([entry])}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(orderCards.orderId, orderId))
      .returning();
    return toRow(rows[0]);
  }

  async listOlderThan(before: Date, limit: number): Promise<OrderCardRow[]> {
    const rows = await this.dbx
      .select()
      .from(orderCards)
      .where(lt(orderCards.createdAt, before))
      .orderBy(asc(orderCards.createdAt))
      .limit(limit);
    return rows.map(toRow).filter((row): row is OrderCardRow => row !== null);
  }

  async forget(orderId: string): Promise<void> {
    await this.dbx.delete(orderCards).where(eq(orderCards.orderId, orderId));
  }

  /**
   * orders.telegram_message_id держим синхронно с карточкой: на него смотрят
   * легаси-пути (первичная отправка в finalize, миграция) — иначе после
   * переезда там остался бы id удалённого сообщения.
   */
  private async syncOrderMessageId(orderId: string, messageId: number): Promise<void> {
    try {
      await this.dbx
        .update(orders)
        .set({ telegramMessageId: messageId })
        .where(eq(orders.id, orderId));
    } catch (e) {
      console.error('[telegram] не удалось обновить orders.telegram_message_id:', e);
    }
  }
}

let defaultStore: OrderCardStore | null = null;

export function getOrderCardStore(): OrderCardStore {
  if (!defaultStore) defaultStore = new DrizzleOrderCardStore();
  return defaultStore;
}

/** Подмена стора в тестах (in-memory с теми же CAS-семантиками). */
export function setOrderCardStoreForTests(store: OrderCardStore | null): void {
  defaultStore = store;
}
