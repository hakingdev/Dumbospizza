import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import db from '../db/client';
import {
  orders,
  payments,
  paymentEvents,
  refunds,
  type Order,
  type Payment,
  type Refund,
} from '../db/schema';

/**
 * Слой хранилища платежей. Все гарантии атомарности собраны здесь:
 *
 *  - claimOrderPaid / markOrderPaymentFailed — CAS-апдейты заказа (guarded
 *    UPDATE ... WHERE payment_status='pending'): из N конкурентных вызовов
 *    ровно один получает true → ровно одна финализация (паттерн SumUp confirm).
 *  - updatePaymentLocked — SELECT ... FOR UPDATE строки платежа: capture и
 *    вебхук по одному платежу выполняются строго последовательно.
 *  - insertEventIfNew — INSERT ... ON CONFLICT DO NOTHING по UNIQUE
 *    (provider, event_id): дубль вебхука определяется атомарно.
 *  - runInTransaction — вся обработка вебхука вместе с записью события идёт
 *    в одной транзакции: упали на середине → событие не записано → ретрай
 *    PayPal обработает его заново.
 *
 * Интерфейс вынесен, чтобы тесты подменяли реализацию in-memory-стором с теми
 * же CAS-семантиками (setPayPalStoreForTests) и гоняли настоящую логику
 * сервисного слоя без Postgres.
 */

export type PaymentPatch = Partial<
  Pick<Payment, 'status' | 'providerCaptureId' | 'rawPayload' | 'amountMinor' | 'currency'>
>;

export type RefundPatch = Partial<Pick<Refund, 'status' | 'providerRefundId' | 'reason'>>;

export interface InsertPaymentData {
  orderId: string;
  provider: string;
  providerOrderId: string;
  status: string;
  amountMinor: number;
  currency: string;
  rawPayload?: unknown;
}

export interface InsertRefundData {
  paymentId: string;
  requestId: string;
  amountMinor: number;
  status: string;
  reason?: string | null;
  createdBy?: string | null;
  providerRefundId?: string | null;
}

export interface PayPalStore {
  /** Вся обработка события в одной транзакции (вложенные вызовы — на txStore). */
  runInTransaction<T>(fn: (txStore: PayPalStore) => Promise<T>): Promise<T>;

  getOrderById(orderId: string): Promise<Order | null>;
  /** CAS pending|failed→completed. true — именно этот вызов перевёл заказ в оплаченные. */
  claimOrderPaid(orderId: string): Promise<boolean>;
  /** CAS pending→failed (оплаченный заказ не трогает). */
  markOrderPaymentFailed(orderId: string): Promise<boolean>;

  findPaymentById(paymentId: string): Promise<Payment | null>;
  findPaymentByProviderOrderId(provider: string, providerOrderId: string): Promise<Payment | null>;
  findPaymentByCaptureId(provider: string, captureId: string): Promise<Payment | null>;
  /** Свежий платёж status='created' с той же суммой — для переиспользования PayPal Order. */
  findReusableCreatedPayment(
    orderId: string,
    provider: string,
    amountMinor: number
  ): Promise<Payment | null>;
  listPaymentsByOrder(orderId: string): Promise<Payment[]>;
  /** INSERT ... ON CONFLICT (provider, provider_order_id) DO NOTHING → актуальная строка. */
  insertPaymentCreated(data: InsertPaymentData): Promise<Payment>;
  /**
   * Обновление платежа под SELECT ... FOR UPDATE: колбэк получает свежую строку,
   * возвращает патч или null (ничего не менять). Возвращает итоговую строку.
   */
  updatePaymentLocked(
    paymentId: string,
    fn: (fresh: Payment) => PaymentPatch | null | Promise<PaymentPatch | null>
  ): Promise<Payment>;

  /** true — событие новое (записано); false — дубль по UNIQUE(provider, event_id). */
  insertEventIfNew(
    provider: string,
    eventId: string,
    eventType: string,
    payload: unknown
  ): Promise<boolean>;

  insertRefund(data: InsertRefundData): Promise<Refund>;
  updateRefund(refundId: string, patch: RefundPatch): Promise<void>;
  findRefundByProviderRefundId(providerRefundId: string): Promise<Refund | null>;
  /** pending-возврат без provider_refund_id (сбой до/во время вызова) — для ретрая. */
  findPendingRefundWithoutProviderId(
    paymentId: string,
    amountMinor: number
  ): Promise<Refund | null>;
  listRefundsByPayment(paymentId: string): Promise<Refund[]>;
  /** Сумма возвратов платежа в центах по перечисленным статусам. */
  sumRefundsMinor(paymentId: string, statuses: string[]): Promise<number>;
}

/** Общая сигнатура drizzle-БД и транзакции — методы, которые использует стор. */
type DbExecutor = Pick<typeof db, 'select' | 'insert' | 'update' | 'transaction'>;

class DrizzlePayPalStore implements PayPalStore {
  constructor(private readonly dbx: DbExecutor = db) {}

  async runInTransaction<T>(fn: (txStore: PayPalStore) => Promise<T>): Promise<T> {
    return this.dbx.transaction(async (tx) => fn(new DrizzlePayPalStore(tx as DbExecutor)));
  }

  async getOrderById(orderId: string): Promise<Order | null> {
    const rows = await this.dbx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    return rows[0] || null;
  }

  async claimOrderPaid(orderId: string): Promise<boolean> {
    // 'failed' тоже допускает переход: после DENIED клиент вправе оплатить
    // заказ повторно (новый capture COMPLETED должен довести заказ до paid).
    const rows = await this.dbx
      .update(orders)
      .set({ paymentStatus: 'completed' })
      .where(and(eq(orders.id, orderId), inArray(orders.paymentStatus, ['pending', 'failed'])))
      .returning({ id: orders.id });
    return rows.length > 0;
  }

  async markOrderPaymentFailed(orderId: string): Promise<boolean> {
    const rows = await this.dbx
      .update(orders)
      .set({ paymentStatus: 'failed' })
      .where(and(eq(orders.id, orderId), eq(orders.paymentStatus, 'pending')))
      .returning({ id: orders.id });
    return rows.length > 0;
  }

  async findPaymentById(paymentId: string): Promise<Payment | null> {
    const rows = await this.dbx.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    return rows[0] || null;
  }

  async findPaymentByProviderOrderId(
    provider: string,
    providerOrderId: string
  ): Promise<Payment | null> {
    const rows = await this.dbx
      .select()
      .from(payments)
      .where(and(eq(payments.provider, provider), eq(payments.providerOrderId, providerOrderId)))
      .limit(1);
    return rows[0] || null;
  }

  async findPaymentByCaptureId(provider: string, captureId: string): Promise<Payment | null> {
    const rows = await this.dbx
      .select()
      .from(payments)
      .where(and(eq(payments.provider, provider), eq(payments.providerCaptureId, captureId)))
      .limit(1);
    return rows[0] || null;
  }

  async findReusableCreatedPayment(
    orderId: string,
    provider: string,
    amountMinor: number
  ): Promise<Payment | null> {
    const rows = await this.dbx
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.orderId, orderId),
          eq(payments.provider, provider),
          eq(payments.status, 'created'),
          eq(payments.amountMinor, amountMinor)
        )
      )
      .orderBy(desc(payments.createdAt))
      .limit(1);
    return rows[0] || null;
  }

  async listPaymentsByOrder(orderId: string): Promise<Payment[]> {
    return this.dbx
      .select()
      .from(payments)
      .where(eq(payments.orderId, orderId))
      .orderBy(desc(payments.createdAt));
  }

  async insertPaymentCreated(data: InsertPaymentData): Promise<Payment> {
    const inserted = await this.dbx
      .insert(payments)
      .values(data)
      .onConflictDoNothing({ target: [payments.provider, payments.providerOrderId] })
      .returning();
    if (inserted[0]) return inserted[0];
    // Конфликт: PayPal вернул тот же Order (идемпотентный PayPal-Request-Id) —
    // строка уже есть, отдаём её.
    const existing = await this.findPaymentByProviderOrderId(data.provider, data.providerOrderId);
    if (!existing) throw new Error('payments: insert conflict, aber Zeile nicht gefunden');
    return existing;
  }

  async updatePaymentLocked(
    paymentId: string,
    fn: (fresh: Payment) => PaymentPatch | null | Promise<PaymentPatch | null>
  ): Promise<Payment> {
    return this.dbx.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, paymentId))
        .limit(1)
        .for('update');
      const fresh = rows[0];
      if (!fresh) throw new Error(`payments: ${paymentId} nicht gefunden`);
      const patch = await fn(fresh);
      if (!patch || Object.keys(patch).length === 0) return fresh;
      const updated = await tx
        .update(payments)
        .set(patch)
        .where(eq(payments.id, paymentId))
        .returning();
      return updated[0] || fresh;
    });
  }

  async insertEventIfNew(
    provider: string,
    eventId: string,
    eventType: string,
    payload: unknown
  ): Promise<boolean> {
    const rows = await this.dbx
      .insert(paymentEvents)
      .values({ provider, eventId, eventType, payload })
      .onConflictDoNothing({ target: [paymentEvents.provider, paymentEvents.eventId] })
      .returning({ id: paymentEvents.id });
    return rows.length > 0;
  }

  async insertRefund(data: InsertRefundData): Promise<Refund> {
    const rows = await this.dbx.insert(refunds).values(data).returning();
    return rows[0]!;
  }

  async updateRefund(refundId: string, patch: RefundPatch): Promise<void> {
    await this.dbx.update(refunds).set(patch).where(eq(refunds.id, refundId));
  }

  async findRefundByProviderRefundId(providerRefundId: string): Promise<Refund | null> {
    const rows = await this.dbx
      .select()
      .from(refunds)
      .where(eq(refunds.providerRefundId, providerRefundId))
      .limit(1);
    return rows[0] || null;
  }

  async findPendingRefundWithoutProviderId(
    paymentId: string,
    amountMinor: number
  ): Promise<Refund | null> {
    const rows = await this.dbx
      .select()
      .from(refunds)
      .where(
        and(
          eq(refunds.paymentId, paymentId),
          eq(refunds.status, 'pending'),
          isNull(refunds.providerRefundId),
          eq(refunds.amountMinor, amountMinor)
        )
      )
      .orderBy(desc(refunds.createdAt))
      .limit(1);
    return rows[0] || null;
  }

  async listRefundsByPayment(paymentId: string): Promise<Refund[]> {
    return this.dbx
      .select()
      .from(refunds)
      .where(eq(refunds.paymentId, paymentId))
      .orderBy(desc(refunds.createdAt));
  }

  async sumRefundsMinor(paymentId: string, statuses: string[]): Promise<number> {
    if (statuses.length === 0) return 0;
    const rows = await this.dbx
      .select({ total: sql<number>`coalesce(sum(${refunds.amountMinor}), 0)::int` })
      .from(refunds)
      .where(and(eq(refunds.paymentId, paymentId), inArray(refunds.status, statuses)));
    return Number(rows[0]?.total || 0);
  }
}

let currentStore: PayPalStore | null = null;

/** Стор по умолчанию (drizzle/Postgres). */
export function getPayPalStore(): PayPalStore {
  if (!currentStore) currentStore = new DrizzlePayPalStore();
  return currentStore;
}

/** Подмена стора в тестах (null — вернуть drizzle-реализацию). */
export function setPayPalStoreForTests(store: PayPalStore | null): void {
  currentStore = store;
}
