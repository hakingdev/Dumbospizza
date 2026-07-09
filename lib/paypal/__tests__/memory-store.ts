import type {
  InsertPaymentData,
  InsertRefundData,
  PaymentPatch,
  PayPalStore,
  RefundPatch,
} from '../store';
import type { Order, Payment, Refund } from '../../db/schema';

/**
 * In-memory реализация PayPalStore для тестов — с ТЕМИ ЖЕ семантиками
 * атомарности, что и drizzle-реализация:
 *  - claimOrderPaid / markOrderPaymentFailed — CAS (атомарно в одном тике JS);
 *  - updatePaymentLocked — глобальная очередь (эквивалент FOR UPDATE:
 *    конкурентные обновления платежа строго последовательны);
 *  - insertEventIfNew — уникальность (provider, event_id);
 *  - runInTransaction — snapshot/rollback: исключение внутри колбэка
 *    откатывает все изменения (как транзакция Postgres).
 *
 * Так тесты гоняют НАСТОЯЩУЮ логику сервисного слоя (гонки, идемпотентность,
 * сверку сумм) без Postgres; сами по себе SQL-гарантии (UNIQUE, FOR UPDATE)
 * здесь не проверяются.
 */

type OrderRow = Order;

let idSeq = 1;
function genId(prefix: string): string {
  return `${prefix}${String(idSeq++).padStart(8, '0')}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryPayPalStore implements PayPalStore {
  orders = new Map<string, OrderRow>();
  payments = new Map<string, Payment>();
  refunds = new Map<string, Refund>();
  events = new Map<string, { eventType: string; payload: unknown }>();

  /** Сколько раз claimOrderPaid вернул true — «ровно одна финализация». */
  claimCount = 0;

  private lockQueue: Promise<unknown> = Promise.resolve();

  seedOrder(partial: Partial<OrderRow> & { id: string }): OrderRow {
    const order = {
      orderNumber: `T-${partial.id}`,
      user: null,
      customerName: 'Test Kunde',
      phoneNumber: '+491700000000',
      items: [],
      deliveryType: 'pickup',
      deliveryFee: 0,
      subtotal: 0,
      tax: 0,
      total: 0,
      paymentMethod: 'online',
      paymentStatus: 'pending',
      status: 'new',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...partial,
    } as OrderRow;
    this.orders.set(order.id, order);
    return order;
  }

  async runInTransaction<T>(fn: (txStore: PayPalStore) => Promise<T>): Promise<T> {
    // Snapshot/rollback — эквивалент транзакции.
    const snapshot = {
      orders: clone(Array.from(this.orders.entries())),
      payments: clone(Array.from(this.payments.entries())),
      refunds: clone(Array.from(this.refunds.entries())),
      events: clone(Array.from(this.events.entries())),
      claimCount: this.claimCount,
    };
    try {
      return await fn(this);
    } catch (e) {
      this.orders = new Map(snapshot.orders);
      this.payments = new Map(snapshot.payments);
      this.refunds = new Map(snapshot.refunds);
      this.events = new Map(snapshot.events);
      this.claimCount = snapshot.claimCount;
      throw e;
    }
  }

  async getOrderById(orderId: string): Promise<OrderRow | null> {
    const row = this.orders.get(orderId);
    return row ? clone(row) : null;
  }

  async claimOrderPaid(orderId: string): Promise<boolean> {
    const row = this.orders.get(orderId);
    if (!row || !['pending', 'failed'].includes(row.paymentStatus)) return false;
    row.paymentStatus = 'completed';
    this.claimCount += 1;
    return true;
  }

  async markOrderPaymentFailed(orderId: string): Promise<boolean> {
    const row = this.orders.get(orderId);
    if (!row || row.paymentStatus !== 'pending') return false;
    row.paymentStatus = 'failed';
    return true;
  }

  async findPaymentById(paymentId: string): Promise<Payment | null> {
    const row = this.payments.get(paymentId);
    return row ? clone(row) : null;
  }

  async findPaymentByProviderOrderId(
    provider: string,
    providerOrderId: string
  ): Promise<Payment | null> {
    for (const p of this.payments.values()) {
      if (p.provider === provider && p.providerOrderId === providerOrderId) return clone(p);
    }
    return null;
  }

  async findPaymentByCaptureId(provider: string, captureId: string): Promise<Payment | null> {
    for (const p of this.payments.values()) {
      if (p.provider === provider && p.providerCaptureId === captureId) return clone(p);
    }
    return null;
  }

  async findReusableCreatedPayment(
    orderId: string,
    provider: string,
    amountMinor: number
  ): Promise<Payment | null> {
    for (const p of this.payments.values()) {
      if (
        p.orderId === orderId &&
        p.provider === provider &&
        p.status === 'created' &&
        p.amountMinor === amountMinor
      ) {
        return clone(p);
      }
    }
    return null;
  }

  async listPaymentsByOrder(orderId: string): Promise<Payment[]> {
    return Array.from(this.payments.values())
      .filter((p) => p.orderId === orderId)
      .map(clone);
  }

  async insertPaymentCreated(data: InsertPaymentData): Promise<Payment> {
    const existing = await this.findPaymentByProviderOrderId(data.provider, data.providerOrderId);
    if (existing) return existing;
    const row = {
      id: genId('pay'),
      orderId: data.orderId,
      provider: data.provider,
      providerOrderId: data.providerOrderId,
      providerCaptureId: null,
      status: data.status,
      amountMinor: data.amountMinor,
      currency: data.currency,
      rawPayload: data.rawPayload ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Payment;
    this.payments.set(row.id, row);
    return clone(row);
  }

  async updatePaymentLocked(
    paymentId: string,
    fn: (fresh: Payment) => PaymentPatch | null | Promise<PaymentPatch | null>
  ): Promise<Payment> {
    // Глобальная очередь — конкурентные вызовы строго последовательны (FOR UPDATE).
    const run = async (): Promise<Payment> => {
      const row = this.payments.get(paymentId);
      if (!row) throw new Error(`payments: ${paymentId} nicht gefunden`);
      const patch = await fn(clone(row));
      if (patch && Object.keys(patch).length > 0) {
        Object.assign(row, patch, { updatedAt: new Date() });
      }
      return clone(row);
    };
    const chained = this.lockQueue.then(run, run);
    this.lockQueue = chained.catch(() => undefined);
    return chained;
  }

  async insertEventIfNew(
    provider: string,
    eventId: string,
    eventType: string,
    payload: unknown
  ): Promise<boolean> {
    const key = `${provider}:${eventId}`;
    if (this.events.has(key)) return false;
    this.events.set(key, { eventType, payload });
    return true;
  }

  async insertRefund(data: InsertRefundData): Promise<Refund> {
    const row = {
      id: genId('ref'),
      paymentId: data.paymentId,
      providerRefundId: data.providerRefundId ?? null,
      requestId: data.requestId,
      amountMinor: data.amountMinor,
      status: data.status,
      reason: data.reason ?? null,
      createdBy: data.createdBy ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Refund;
    this.refunds.set(row.id, row);
    return clone(row);
  }

  async updateRefund(refundId: string, patch: RefundPatch): Promise<void> {
    const row = this.refunds.get(refundId);
    if (row) Object.assign(row, patch, { updatedAt: new Date() });
  }

  async findRefundByProviderRefundId(providerRefundId: string): Promise<Refund | null> {
    for (const r of this.refunds.values()) {
      if (r.providerRefundId === providerRefundId) return clone(r);
    }
    return null;
  }

  async findPendingRefundWithoutProviderId(
    paymentId: string,
    amountMinor: number
  ): Promise<Refund | null> {
    for (const r of this.refunds.values()) {
      if (
        r.paymentId === paymentId &&
        r.status === 'pending' &&
        !r.providerRefundId &&
        r.amountMinor === amountMinor
      ) {
        return clone(r);
      }
    }
    return null;
  }

  async listRefundsByPayment(paymentId: string): Promise<Refund[]> {
    return Array.from(this.refunds.values())
      .filter((r) => r.paymentId === paymentId)
      .map(clone);
  }

  async sumRefundsMinor(paymentId: string, statuses: string[]): Promise<number> {
    let total = 0;
    for (const r of this.refunds.values()) {
      if (r.paymentId === paymentId && statuses.includes(r.status)) total += r.amountMinor;
    }
    return total;
  }
}
