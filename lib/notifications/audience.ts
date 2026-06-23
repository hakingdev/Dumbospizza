/**
 * Резолвинг получателей рассылки по сегменту.
 *
 * Сегменты (ТЗ §5): всем / одному / группе / давно не заказывали /
 * частым покупателям конкретного продукта.
 *
 * Чистые помощники (tallyByPhone, isInactive, countOrdersWithProductByPhone)
 * вынесены для тестов; resolveRecipients делает запросы к БД.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import db from '../db/client';
import { users, orders } from '../db/schema';

export type AudienceSpec =
  | { type: 'all' }
  | { type: 'customer'; userId: string }
  | { type: 'customers'; userIds: string[] }
  | { type: 'inactive'; days: number }
  | { type: 'product'; productId: string; minCount?: number };

export interface Recipient {
  userId: string;
  phoneNumber: string;
}

// --- Чистые помощники (тестируемые) ---

/** Подсчёт строк по номеру телефона. */
export function tallyByPhone(rows: { phoneNumber: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!r.phoneNumber) continue;
    m.set(r.phoneNumber, (m.get(r.phoneNumber) || 0) + 1);
  }
  return m;
}

/** Считается ли клиент неактивным: последний заказ раньше cutoff. */
export function isInactive(lastOrderDate: Date | string | null | undefined, cutoff: Date): boolean {
  if (!lastOrderDate) return false; // никогда не заказывал — не «давно не заказывал»
  return new Date(lastOrderDate).getTime() < cutoff.getTime();
}

/**
 * Телефоны частых покупателей продукта: из уже отфильтрованных заказов
 * (каждый содержит продукт) оставить телефоны с count >= minCount.
 */
export function frequentBuyerPhones(
  ordersWithProduct: { phoneNumber: string }[],
  minCount: number
): Set<string> {
  const tally = tallyByPhone(ordersWithProduct);
  const out = new Set<string>();
  tally.forEach((count, phone) => {
    if (count >= minCount) out.add(phone);
  });
  return out;
}

// --- Резолвинг по БД ---

async function customersByPhones(phones: string[]): Promise<Recipient[]> {
  if (phones.length === 0) return [];
  const rows = await db
    .select({ userId: users.id, phoneNumber: users.phoneNumber })
    .from(users)
    .where(and(eq(users.role, 'customer'), inArray(users.phoneNumber, phones)));
  return rows;
}

export async function resolveRecipients(spec: AudienceSpec): Promise<Recipient[]> {
  switch (spec.type) {
    case 'all': {
      return db
        .select({ userId: users.id, phoneNumber: users.phoneNumber })
        .from(users)
        .where(eq(users.role, 'customer'));
    }

    case 'customer': {
      const rows = await db
        .select({ userId: users.id, phoneNumber: users.phoneNumber })
        .from(users)
        .where(eq(users.id, spec.userId))
        .limit(1);
      return rows;
    }

    case 'customers': {
      if (!spec.userIds?.length) return [];
      return db
        .select({ userId: users.id, phoneNumber: users.phoneNumber })
        .from(users)
        .where(inArray(users.id, spec.userIds));
    }

    case 'inactive': {
      const cutoff = new Date(Date.now() - spec.days * 24 * 60 * 60 * 1000);
      // последний заказ по каждому телефону
      const lastOrders = await db
        .select({
          phoneNumber: orders.phoneNumber,
          lastAt: sql<string>`max(${orders.createdAt})`,
        })
        .from(orders)
        .groupBy(orders.phoneNumber);
      const phones = lastOrders.filter((r) => isInactive(r.lastAt, cutoff)).map((r) => r.phoneNumber);
      return customersByPhones(phones);
    }

    case 'product': {
      const minCount = spec.minCount && spec.minCount > 0 ? spec.minCount : 1;
      // Заказы, содержащие продукт (jsonb containment по items[].product).
      const containment = JSON.stringify([{ product: spec.productId }]);
      const rows = await db
        .select({ phoneNumber: orders.phoneNumber })
        .from(orders)
        .where(sql`${orders.items} @> ${containment}::jsonb`);
      const phones = Array.from(frequentBuyerPhones(rows, minCount));
      return customersByPhones(phones);
    }

    default:
      return [];
  }
}
