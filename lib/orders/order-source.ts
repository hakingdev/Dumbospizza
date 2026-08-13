/**
 * Канал заказа (orders.source) и единое правило: что считать НАШИМИ деньгами.
 *
 * 'website'    — собственный сайт/приложение: наша выручка, наши бонусы, наши счёта.
 * 'lieferando' — заказ из чека Lieferando, распознанный ботом-диспетчером
 *                (lib/lieferando/receipt-import.ts). Деньги считает Lieferando
 *                в своём портале, поэтому такие заказы НЕ входят:
 *                  - в выручку/баланс дня и статистику дашборда,
 *                  - в средний чек и аналитику по товарам,
 *                  - в бонусную программу (начисления, тиры, «первый заказ»),
 *                  - в счёта с НДС и в offline-конверсии для рекламных систем,
 *                  - в сегментацию «новый/вернувшийся клиент» для акций.
 *
 * Но они ПОЛНОСТЬЮ участвуют в работе кухни: очередь, AI-план, маршруты,
 * оценка времени, печать. Это реальная загрузка кухни и реальные адреса —
 * см. lib/eta/kitchen-plan.ts и lib/eta/order-eta.ts (там фильтра быть НЕ должно).
 *
 * Правило простое: любая агрегация ДЕНЕГ или клиентской истории → фильтр отсюда;
 * любая выборка ДЛЯ КУХНИ → без фильтра.
 */

import { sql, type SQL } from 'drizzle-orm';

export const WEBSITE_SOURCE = 'website';
export const LIEFERANDO_SOURCE = 'lieferando';

/** Заказ пришёл из чека Lieferando (деньги считает Lieferando, не мы). */
export function isLieferandoOrder(order: { source?: string | null } | null | undefined): boolean {
  return order?.source === LIEFERANDO_SOURCE;
}

/**
 * Фильтр для выборок в Mongo-стиле (mongoose-compat): только наши деньги.
 * Использование: `Order.countDocuments({ ...ownRevenueQuery(), status: ... })`.
 */
export function ownRevenueQuery(): { source: { $ne: string } } {
  return { source: { $ne: LIEFERANDO_SOURCE } };
}

/**
 * То же условие для raw SQL (db.execute) и drizzle-выборок.
 * COALESCE — страховка: если колонку когда-то добавят nullable, NULL не должен
 * молча выкидывать все строки из отчёта.
 */
export function ownRevenueSql(): SQL {
  return sql`coalesce(source, ${WEBSITE_SOURCE}) <> ${LIEFERANDO_SOURCE}`;
}

/** Версия для drizzle-select с алиасом таблицы (orders.source). */
export function ownRevenueSqlFor(column: unknown): SQL {
  return sql`coalesce(${column as any}, ${WEBSITE_SOURCE}) <> ${LIEFERANDO_SOURCE}`;
}
