import { like, desc } from 'drizzle-orm';
import db from '../db/client';
import { orders } from '../db/schema';

/** Исполнитель drizzle (db или транзакция) — методы, которые использует генератор. */
type DbExecutor = Pick<typeof db, 'select'>;

/**
 * Следующий orderNumber: YYMMDD + порядковый номер дня (001, 002, …).
 *
 * Единственный источник нумерации: pre-save хук заказа (cash/card — номер при
 * создании) и промоут оплаченного драфта (online — номер ТОЛЬКО после оплаты,
 * см. lib/orders/payment-draft.ts). Гонку двух одновременных генераций ловит
 * уникальный индекс orders_order_number_uq — вызывающий код ретраит со свежим
 * кандидатом.
 */
export async function generateNextOrderNumber(dbx: DbExecutor = db, now = new Date()): Promise<string> {
  const dateString =
    now.getFullYear().toString().slice(-2) +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');

  const last = await dbx
    .select({ orderNumber: orders.orderNumber })
    .from(orders)
    .where(like(orders.orderNumber, `${dateString}%`))
    .orderBy(desc(orders.orderNumber))
    .limit(1);

  let sequenceNumber = '001';
  if (last[0]?.orderNumber) {
    const lastSequence = parseInt(last[0].orderNumber.slice(-3), 10);
    sequenceNumber = String(lastSequence + 1).padStart(3, '0');
  }
  return `${dateString}${sequenceNumber}`;
}
