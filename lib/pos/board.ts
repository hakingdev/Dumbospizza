/**
 * Заказ из базы → строка ленты терминала.
 *
 * Модуль ЧИСТЫЙ (без базы и сети): его импортирует и маршрут `/api/pos/v1/board`,
 * и клиентские экраны — типы у отправителя и получателя обязаны быть одни.
 *
 * Немецкие подписи здесь НЕ собираются. Сервер отдаёт факты (тип доставки,
 * адрес, дедлайн), а слова подбирает экран: иначе одна и та же строка «Noch
 * 12:30 Min» существовала бы в двух местах и разошлась бы при первой правке.
 */

import { formatOrderAddress } from './print-job';

/** Статусы в том виде, в каком их различает терминал. */
export type PosBoardStatus =
  | 'new'
  | 'preparing'
  | 'ready'
  | 'delivering'
  | 'delivered'
  | 'cancelled';

/**
 * Статус заказа в базе ↔ статус терминала.
 *
 * Различаются только именами: 'ready_for_delivery' у нас «Bereit», 'completed'
 * — «Geliefert». Справочник двусторонний, чтобы кнопка терминала не отправила
 * на сервер статус, которого в модели нет.
 */
const TO_BOARD: Record<string, PosBoardStatus> = {
  new: 'new',
  preparing: 'preparing',
  ready_for_delivery: 'ready',
  delivering: 'delivering',
  completed: 'delivered',
  cancelled: 'cancelled',
};

const TO_ORDER: Record<PosBoardStatus, string> = {
  new: 'new',
  preparing: 'preparing',
  ready: 'ready_for_delivery',
  delivering: 'delivering',
  delivered: 'completed',
  cancelled: 'cancelled',
};

export function toBoardStatus(status: unknown): PosBoardStatus | null {
  return TO_BOARD[String(status || '')] ?? null;
}

export function toOrderStatus(status: PosBoardStatus): string {
  return TO_ORDER[status];
}

/** Статусы, которые кухня считает незакрытыми: их показываем без ограничения по дате. */
export const POS_ACTIVE_ORDER_STATUSES = [
  'new',
  'preparing',
  'ready_for_delivery',
  'delivering',
] as const;

export const POS_FINISHED_ORDER_STATUSES = ['completed', 'cancelled'] as const;

const BERLIN_TZ = 'Europe/Berlin';

/**
 * Календарный день в Берлине, «2026-08-18».
 *
 * Сравниваем именно ключи дня, а не считаем полночь смещением: в дни перевода
 * часов арифметика по смещению ошибается на час, а формат — нет.
 */
export function berlinDayKey(value: Date | string | number, timeZone = BERLIN_TZ): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** «24,80 €» — формат экрана. На чеке формат другой, он в formatEuro. */
export function posEuro(value: unknown): string {
  return `${(Number(value) || 0).toFixed(2).replace('.', ',')} €`;
}

/**
 * Когда заказ обещан гостю, epoch ms. null — обещания ещё нет.
 *
 * Считается от `etaSetAt`, а не от создания заказа: продление сдвигает именно
 * эту пару полей, и лента обязана показывать сдвинутый срок, а не исходный.
 */
export function orderDueMs(order: {
  etaMinutes?: number | null;
  etaSetAt?: Date | string | null;
  createdAt?: Date | string | null;
}): number | null {
  const minutes = Number(order.etaMinutes);
  if (!Number.isFinite(minutes)) return null;
  const base = order.etaSetAt ?? order.createdAt;
  const baseMs = base ? new Date(base).getTime() : NaN;
  if (Number.isNaN(baseMs)) return null;
  return baseMs + minutes * 60_000;
}

/** Сколько позиций перечислять в карточке, прежде чем свернуть в «+N». */
const ITEMS_PREVIEW = 3;

/** «2× Pizza Margherita · 1× Pommes · +2 weitere» */
export function summarizeItems(items: Array<{ name?: string; quantity?: number }> = []): string {
  const shown = items
    .slice(0, ITEMS_PREVIEW)
    .map((i) => `${Number(i.quantity) || 1}× ${String(i.name || '').trim()}`)
    .filter(Boolean);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(' · ')} · +${rest} weitere` : shown.join(' · ');
}

/** Откуда пришёл заказ. Строка попадает в карточку как «via …». */
export function orderChannel(order: { source?: string | null }): string {
  switch (String(order.source || '')) {
    case 'lieferando':
      return 'Lieferando';
    case 'website':
      return 'Website';
    default:
      return 'Telefon';
  }
}

export interface PosBoardOrder {
  id: string;
  number: string;
  status: PosBoardStatus;
  deliveryType: 'delivery' | 'pickup';
  /** Адрес доставки либо пусто у самовывоза. */
  address: string;
  channel: string;
  customerName: string;
  items: string;
  total: string;
  /** Обещанное время готовности, epoch ms. Отсчёт прибор ведёт сам. */
  dueMs: number | null;
  /** На сколько минут дано обещание — из него считается полоса прогресса. */
  etaMinutes: number | null;
  /** Когда заказ приняли, epoch ms — для подписи «Angenommen 18:47». */
  createdMs: number;
  /**
   * Когда заказ пришёл в нынешний статус, epoch ms. Нужен закрытым карточкам:
   * «Zugestellt 18:51 · 34 Min» — это время последней записи в истории, а не
   * времени создания.
   */
  closedMs: number | null;
  /** Онлайн-оплата подтверждена (или наличные — тогда платят на месте). */
  paid: boolean;
}

/** Заказ из базы → строка ленты. Всё, что нужно карточке, и ничего лишнего. */
export function toBoardOrder(order: any): PosBoardOrder | null {
  const status = toBoardStatus(order?.status);
  if (!status) return null;

  return {
    id: String(order._id ?? order.id ?? ''),
    number: String(order.orderNumber ?? ''),
    status,
    deliveryType: order.deliveryType === 'pickup' ? 'pickup' : 'delivery',
    address: formatOrderAddress(order) ?? '',
    channel: orderChannel(order),
    customerName: String(order.customerName ?? ''),
    items: summarizeItems(order.items ?? []),
    total: posEuro(order.total),
    dueMs: orderDueMs(order),
    etaMinutes: Number.isFinite(Number(order.etaMinutes)) ? Number(order.etaMinutes) : null,
    createdMs: order.createdAt ? new Date(order.createdAt).getTime() : 0,
    closedMs: statusChangedMs(order),
    paid: order.paymentMethod !== 'online' || order.paymentStatus === 'completed',
  };
}

/** Когда заказ получил нынешний статус. null — истории нет (старые заказы). */
function statusChangedMs(order: any): number | null {
  const updates: Array<{ status?: string; timestamp?: string | Date }> = order?.statusUpdates ?? [];
  for (let i = updates.length - 1; i >= 0; i -= 1) {
    if (updates[i]?.status !== order.status) continue;
    const ms = new Date(updates[i].timestamp as any).getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/** Сколько заказов в каждом статусе — числа на вкладках. */
export type PosBoardCounts = Record<PosBoardStatus, number>;

export function countByStatus(orders: PosBoardOrder[]): PosBoardCounts {
  const counts: PosBoardCounts = {
    new: 0,
    preparing: 0,
    ready: 0,
    delivering: 0,
    delivered: 0,
    cancelled: 0,
  };
  for (const order of orders) counts[order.status] += 1;
  return counts;
}
