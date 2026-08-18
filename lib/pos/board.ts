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
import { orderDueMs } from '../orders/promise';

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

/**
 * Статус, которым заказ показывают на экране терминала.
 *
 * `ready_for_delivery` у доставки означает не «стоит готовый на полке», а
 * «уехал к гостю»: в Telegram кнопка так и называется («🚚 Доставка»), карточка
 * переезжает в тему доставки, и гость в ту же секунду получает «ist unterwegs»
 * (STATUS_LABELS в lib/whatsapp.ts). Терминал был единственным местом, где
 * такой заказ оставался в «Zubereitung» — кухня видела на столе работу,
 * которой там уже нет, а вкладка «Unterwegs» стояла пустой.
 *
 * У самовывоза «unterwegs» не бывает: там тот же статус значит «ждёт гостя»,
 * и заказ обязан остаться на кухонной вкладке.
 */
export function posDisplayStatus(order: {
  status: PosBoardStatus;
  deliveryType?: string | null;
}): PosBoardStatus {
  if (order.status === 'ready' && order.deliveryType !== 'pickup') return 'delivering';
  return order.status;
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

/**
 * Смещение зоны относительно UTC в конкретный момент, мс.
 *
 * Считается форматированием, а не таблицей правил: летнее время, високосные
 * секунды и исторические сдвиги знает ICU, а не мы.
 */
function zoneOffsetMs(atMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(atMs));
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // en-US с hour12:false отдаёт полночь как «24» — Date.UTC приняла бы её за
  // следующие сутки.
  const hour = num('hour') % 24;
  const asUtc = Date.UTC(num('year'), num('month') - 1, num('day'), hour, num('minute'), num('second'));
  return asUtc - atMs;
}

/**
 * Wunschzeit гостя «20:30» → момент времени, epoch ms.
 *
 * Час гость называет по часам ЗАВЕДЕНИЯ, а сервер на Vercel живёт в UTC —
 * поэтому «20:30» без зоны означало бы 22:30 по Берлину летом.
 *
 * `reference` — момент, к суткам которого час относится (время заказа).
 * Заказ в 23:50 «на 00:15» — это следующие сутки; шесть часов допуска отделяют
 * такой случай от Wunschzeit, которая просто прошла (гость ждёт, кухня опоздала).
 */
export function desiredTimeMs(
  desired: unknown,
  reference: Date | string | number,
  timeZone = BERLIN_TZ
): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(desired ?? '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  const refMs = reference instanceof Date ? reference.getTime() : new Date(reference).getTime();
  if (Number.isNaN(refMs)) return null;

  const day = berlinDayKey(refMs, timeZone);
  if (!day) return null;
  const [year, month, date] = day.split('-').map(Number);

  // Двухшаговый перевод: смещение сначала берём по наивной метке, потом
  // уточняем по уже полученному моменту. В ночь перевода часов один шаг
  // ошибается ровно на час.
  const naiveUtc = Date.UTC(year, month - 1, date, hours, minutes);
  const firstGuess = naiveUtc - zoneOffsetMs(naiveUtc, timeZone);
  let ms = naiveUtc - zoneOffsetMs(firstGuess, timeZone);
  if (ms < refMs - 6 * 3_600_000) ms += 24 * 3_600_000;
  return ms;
}

/** «24,80 €» — формат экрана. На чеке формат другой, он в formatEuro. */
export function posEuro(value: unknown): string {
  return `${(Number(value) || 0).toFixed(2).replace('.', ',')} €`;
}

/**
 * Когда заказ обещан гостю, epoch ms. Правило переехало в lib/orders/promise.ts:
 * тот же срок печатается на чеке кухни, и разойтись эти два ответа не должны.
 * Реэкспорт оставлен, чтобы вызовы ленты не менялись.
 */
export { orderDueMs } from '../orders/promise';

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
  /**
   * Wunschzeit гостя, epoch ms. null — заказ «как можно скорее».
   *
   * Приходит моментом, а не строкой «20:30»: считать час в зоне заведения
   * должен тот, кто знает дату заказа, а не экран.
   */
  desiredMs: number | null;
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
    desiredMs: desiredTimeMs(order.desiredDeliveryTime, order.createdAt ?? Date.now()),
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

/**
 * Считаем по ЭКРАННОМУ статусу (posDisplayStatus), а не по статусу базы: число
 * на вкладке и её содержимое обязаны совпадать, иначе «Unterwegs 0» стоит над
 * лентой, в которой заказы уже в пути.
 */
export function countByStatus(orders: PosBoardOrder[]): PosBoardCounts {
  const counts: PosBoardCounts = {
    new: 0,
    preparing: 0,
    ready: 0,
    delivering: 0,
    delivered: 0,
    cancelled: 0,
  };
  for (const order of orders) counts[posDisplayStatus(order)] += 1;
  return counts;
}
