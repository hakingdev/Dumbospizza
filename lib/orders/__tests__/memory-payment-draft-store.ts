import type { Order as OrderRow } from '../../db/schema';
import type { PaymentDraftStore } from '../payment-draft';
import { PENDING_PAYMENT_STATUS } from '../payment-draft';

/**
 * In-memory реализация PaymentDraftStore для тестов — с теми же семантиками
 * атомарности, что и drizzle-реализация (паттерн lib/paypal/__tests__/memory-store):
 *
 *  - claimPaidAndPromote — CAS по payment_status + COALESCE-нумерация в одном
 *    «стейтменте» (атомарно в одном тике JS): конфликт уникальности номера
 *    (эмуляция orders_order_number_uq) бросает 23505 ДО каких-либо мутаций;
 *  - markPaymentFailed — CAS pending→failed;
 *  - markStaleDraftsFailed — только неоплаченные драфты старше cutoff.
 *
 * Тесты гоняют НАСТОЯЩУЮ оркестрацию (claimOrderPaidAndPromote,
 * applySumUpCheckoutStatus, cleanupStalePaymentDrafts) без Postgres.
 */

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function uniqueViolation(): Error {
  const e = new Error(
    'duplicate key value violates unique constraint "orders_order_number_uq"'
  ) as Error & { code: string };
  e.code = '23505';
  return e;
}

export class MemoryPaymentDraftStore implements PaymentDraftStore {
  orders = new Map<string, OrderRow>();

  /** Сколько раз claim победил — «ровно одна финализация». */
  claimCount = 0;

  /** Детерминированные кандидаты номеров (иначе — T001, T002, …). */
  nextNumbers: string[] = [];

  private numberSeq = 0;
  private usedNumbers = new Set<string>();

  seedOrder(partial: Partial<OrderRow> & { id: string }): OrderRow {
    const order = {
      orderNumber: null,
      user: null,
      customerName: 'Test Kunde',
      phoneNumber: '+491700000000',
      items: [],
      deliveryType: 'pickup',
      deliveryFee: 0,
      subtotal: 24.9,
      tax: 0,
      total: 24.9,
      paymentMethod: 'online',
      paymentStatus: 'pending',
      status: PENDING_PAYMENT_STATUS,
      statusUpdates: [{ status: PENDING_PAYMENT_STATUS, timestamp: new Date().toISOString() }],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...partial,
    } as OrderRow;
    if (order.orderNumber) this.usedNumbers.add(order.orderNumber);
    this.orders.set(order.id, order);
    return order;
  }

  /** То, что видит оператор в «Заказы» (фильтр visibleOrderStatusFilter). */
  visibleOrders(): OrderRow[] {
    return Array.from(this.orders.values()).filter((o) => o.status !== PENDING_PAYMENT_STATUS);
  }

  async getOrder(orderId: string): Promise<OrderRow | null> {
    const row = this.orders.get(orderId);
    return row ? clone(row) : null;
  }

  async findOrderByCheckoutReference(reference: string): Promise<OrderRow | null> {
    const byId = this.orders.get(reference);
    if (byId) return clone(byId);
    for (const row of Array.from(this.orders.values())) {
      if (row.orderNumber === reference) return clone(row);
    }
    return null;
  }

  async claimPaidAndPromote(
    orderId: string,
    candidate: string,
    now: Date
  ): Promise<OrderRow | null> {
    const row = this.orders.get(orderId);
    if (!row || !['pending', 'failed'].includes(row.paymentStatus)) return null;

    // Конфликт уникальности проверяется ДО мутаций (SQL-стейтмент атомарен).
    const needsNumber = !row.orderNumber;
    if (needsNumber && this.usedNumbers.has(candidate)) throw uniqueViolation();

    if (needsNumber) {
      row.orderNumber = candidate;
      this.usedNumbers.add(candidate);
    }
    row.paymentStatus = 'completed';
    if (row.status === PENDING_PAYMENT_STATUS) {
      row.status = 'new';
      row.statusUpdates = [
        ...((row.statusUpdates as any[]) || []),
        { status: 'new', timestamp: now.toISOString() },
      ] as OrderRow['statusUpdates'];
    }
    row.updatedAt = now;
    this.claimCount += 1;
    return clone(row);
  }

  async markPaymentFailed(orderId: string): Promise<boolean> {
    const row = this.orders.get(orderId);
    if (!row || row.paymentStatus !== 'pending') return false;
    row.paymentStatus = 'failed';
    return true;
  }

  async nextOrderNumber(): Promise<string> {
    return this.nextNumbers.shift() ?? `T${String(++this.numberSeq).padStart(3, '0')}`;
  }

  async markStaleDraftsFailed(cutoff: Date): Promise<Pick<OrderRow, 'id' | 'createdAt'>[]> {
    const marked: Pick<OrderRow, 'id' | 'createdAt'>[] = [];
    for (const row of Array.from(this.orders.values())) {
      if (
        row.status === PENDING_PAYMENT_STATUS &&
        row.paymentStatus === 'pending' &&
        row.createdAt &&
        row.createdAt.getTime() < cutoff.getTime()
      ) {
        row.paymentStatus = 'failed';
        marked.push({ id: row.id, createdAt: row.createdAt });
      }
    }
    return marked;
  }
}
