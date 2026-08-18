'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  PosBoardCounts,
  PosBoardOrder,
  PosBoardStatus,
} from '../../lib/pos/board';
import type { PosStopScope } from './kitchen';
// Типы меню живут в чистом модуле рядом с сервером: у отправителя и получателя
// они обязаны быть одни.
import type { PosMenuCategory, PosMenuItem } from '../../lib/pos/menu';

export type { PosMenuCategory, PosMenuItem, PosMenuSize } from '../../lib/pos/menu';

/**
 * Данные терминала: опрос сервера, часы и немецкие подписи карточек.
 *
 * Часы берутся СЕРВЕРНЫЕ. Прибор стоит на кухне месяцами и его время уезжает;
 * если считать обратный отсчёт по нему, кухня получит чужой таймер и не узнает
 * об этом. Сервер присылает своё время, клиент запоминает поправку и дальше
 * тикает сам — без лишних запросов и без вранья.
 */

export interface PosBoard {
  serverTimeMs: number;
  orders: PosBoardOrder[];
  counts: PosBoardCounts;
  dayTotal: { delivered: string; cancelled: string };
  pause: { scope: PosStopScope; untilIso: string } | null;
}

/**
 * Заказ целиком. Расширяет строку ленты — состав, телефон и предпросмотр бона
 * нужны только открытому экрану, и в ленту их не тащим.
 */
export interface PosOrderDetail extends Omit<PosBoardOrder, 'items'> {
  /** Состав построчно. В ленте на его месте одна строка-выжимка. */
  phone: string;
  note: string;
  paymentMethod: string;
  items: { qty: number; name: string; price: string }[];
  deliveryFee: number;
  print: { status: string; seq: number };
  /** Готовые строки чека на ширину прибора — ровно то, что выйдет из принтера. */
  receiptLines: string[];
}

export type PosLoad<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  /** Сессия персонала кончилась или её не было — прибор надо снова завести. */
  | { status: 'unauthorized' }
  | { status: 'error'; message: string };

/** Насколько часто прибор перечитывает ленту. */
export const POS_POLL_MS = 5000;

interface PosFetchResult<T> {
  ok: boolean;
  data?: T;
  unauthorized?: boolean;
  error?: string;
}

/**
 * Запрос к POS-API. Единая точка, чтобы 401 везде обрабатывался одинаково:
 * на кухне «просто ничего не происходит» — худший из возможных ответов.
 */
export async function posFetch<T = any>(
  url: string,
  init?: RequestInit
): Promise<PosFetchResult<T>> {
  try {
    const response = await fetch(url, {
      ...init,
      // Терминал ходит своей сессией, а ответы кэшировать нельзя: лента
      // из кэша показала бы заказ, который уже уехал.
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
    if (response.status === 401) return { ok: false, unauthorized: true };
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) {
      return { ok: false, error: body?.error || `HTTP ${response.status}` };
    }
    return { ok: true, data: body as T };
  } catch (error: any) {
    // Сеть на кухне отваливается регулярно (Wi-Fi, роутер, VPN). Это не ошибка
    // программы, а состояние, которое экран обязан показать словами.
    return { ok: false, error: error?.message || 'Keine Verbindung' };
  }
}

/**
 * Периодически перечитываемый ресурс POS-API.
 *
 * Один хук на все экраны, потому что у них одни и те же четыре состояния и одна
 * и та же поправка часов. Разные копии этой логики разошлись бы в обработке
 * 401 — а именно она решает, увидит ли кухня «нет входа» или пустой экран.
 *
 * `select` достаёт полезное из ответа: у ленты это сам ответ, у заказа — поле
 * внутри него.
 */
export function usePosResource<TRaw extends object, T>(
  url: string,
  select: (raw: TRaw) => T,
  pollMs = POS_POLL_MS
) {
  const [state, setState] = useState<PosLoad<T>>({ status: 'loading' });
  /** Поправка к часам прибора: serverTimeMs − Date.now() на момент ответа. */
  const skewRef = useRef(0);
  const selectRef = useRef(select);
  selectRef.current = select;

  const refresh = useCallback(async () => {
    // Пустой адрес — «пока нечего грузить» (например, нет входящего заказа).
    // Оставляем состояние загрузки: экран сам знает, что показать вместо данных.
    if (!url) return;
    const result = await posFetch<TRaw>(url);
    if (result.unauthorized) {
      setState({ status: 'unauthorized' });
      return;
    }
    if (!result.ok || !result.data) {
      // Прошлые данные не стираем: лента, устаревшая на секунды, полезнее
      // пустого экрана — заказы на ней всё ещё те же самые.
      setState((prev) =>
        prev.status === 'ready' ? prev : { status: 'error', message: result.error || 'Fehler' }
      );
      return;
    }
    // Не все ответы несут время сервера — у кого несут, по нему и правим часы.
    const serverTimeMs = (result.data as { serverTimeMs?: number }).serverTimeMs;
    if (typeof serverTimeMs === 'number') skewRef.current = serverTimeMs - Date.now();
    setState({ status: 'ready', data: selectRef.current(result.data) });
  }, [url]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);

  return { state, refresh, skewRef };
}

/** Лента заказов: заказы, счётчики и стоп кухни одним запросом. */
export function usePosBoard(pollMs = POS_POLL_MS) {
  return usePosResource<PosBoard, PosBoard>('/api/pos/v1/board', (raw) => raw, pollMs);
}

/**
 * Один заказ. Опрос нужен и здесь: состояние печати меняет не терминал, а агент
 * у кассы — без него карточка бона осталась бы навсегда в «Warteschlange».
 */
export function usePosOrder(id: string | null, pollMs = POS_POLL_MS) {
  return usePosResource<{ order: PosOrderDetail; serverTimeMs: number }, PosOrderDetail>(
    id ? `/api/pos/v1/orders/${encodeURIComponent(id)}` : '',
    (raw) => raw.order,
    pollMs
  );
}

/**
 * Тикающие часы прибора с поправкой на сервер. До монтирования отдаёт null:
 * посчитанное на сервере время разошлось бы с клиентским при гидратации.
 */
export function usePosNow(skewRef?: { current: number }, tickMs = 1000): number | null {
  const [tick, setTick] = useState<number | null>(null);
  useEffect(() => {
    const read = () => setTick(Date.now() + (skewRef?.current ?? 0));
    read();
    const id = setInterval(read, tickMs);
    return () => clearInterval(id);
  }, [skewRef, tickMs]);
  return tick;
}

/** Состояние стопа по областям — экраны 12 и 13. */
export interface PosKitchenScope {
  scope: PosStopScope;
  until: string | null;
  minutesLeft: number;
}

export function usePosKitchen(pollMs = POS_POLL_MS) {
  return usePosResource<{ scopes: PosKitchenScope[] }, PosKitchenScope[]>(
    '/api/pos/v1/kitchen',
    (raw) => raw.scopes,
    pollMs
  );
}

/** Меню меняется редко — опрашиваем реже ленты заказов. */
const MENU_POLL_MS = 30_000;

export function usePosMenu() {
  return usePosResource<{ categories: PosMenuCategory[] }, PosMenuCategory[]>(
    '/api/pos/v1/menu',
    (raw) => raw.categories,
    MENU_POLL_MS
  );
}

export function usePosMenuCategory(categoryId: string) {
  return usePosResource<
    { category: { id: string; name: string }; items: PosMenuItem[] },
    { name: string; items: PosMenuItem[] }
  >(
    `/api/pos/v1/menu?category=${encodeURIComponent(categoryId)}`,
    (raw) => ({ name: raw.category.name, items: raw.items }),
    MENU_POLL_MS
  );
}

/** Погасить или вернуть позицию целиком либо один её размер. */
export function posSetAvailability(body: {
  productId: string;
  available?: boolean;
  sizeId?: string;
  active?: boolean;
}) {
  return posFetch<{ item: PosMenuItem }>('/api/pos/v1/menu', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** Поставить или снять стоп. `minutes: 0` снимает. */
export function posSetStop(scope: PosStopScope, minutes: number) {
  return posFetch('/api/pos/v1/kitchen', {
    method: 'POST',
    body: JSON.stringify({ scope, minutes }),
  });
}

// ---------------------------------------------------------------------------
// Формат времени и подписи карточек
// ---------------------------------------------------------------------------

const BERLIN_TZ = 'Europe/Berlin';

/** «19:20» по времени заведения, а не по часовому поясу прибора. */
export function posClock(ms: number | null | undefined, timeZone = BERLIN_TZ): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(ms));
}

/** «12:30» — минуты и секунды до срока. */
export function posCountdown(msLeft: number): string {
  const total = Math.max(0, Math.round(Math.abs(msLeft) / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** «Lieferung · Musterstr. 12 · via Lieferando» */
export function posOrderMeta(
  order: Pick<PosBoardOrder, 'deliveryType' | 'address' | 'channel'>
): string {
  const where =
    order.deliveryType === 'pickup' ? 'Abholung · Theke' : `Lieferung · ${order.address || '—'}`;
  return `${where} · via ${order.channel}`;
}

/**
 * Левая нижняя строка карточки: таймер там, где он есть, и внятная замена там,
 * где его нет. `overdue` подсвечивает просрочку независимо от статуса.
 */
export function posOrderNote(
  order: PosBoardOrder,
  nowMs: number
): { text: string; overdue: boolean } {
  const left = order.dueMs == null ? null : order.dueMs - nowMs;

  switch (order.status) {
    case 'new':
      return { text: 'Neu · noch nicht angenommen', overdue: false };

    case 'preparing':
      if (left == null) return { text: 'Zeit noch nicht gesetzt', overdue: false };
      return left >= 0
        ? { text: `Noch ${posCountdown(left)} Min · fertig ${posClock(order.dueMs)}`, overdue: false }
        : { text: `Überfällig · +${posCountdown(left)} Min`, overdue: true };

    case 'ready':
      return {
        text: order.deliveryType === 'pickup' ? 'Fertig · wartet auf Abholung' : 'Fertig · wartet auf Fahrer',
        overdue: false,
      };

    case 'delivering':
      return {
        text: order.dueMs ? `Unterwegs · Ankunft ${posClock(order.dueMs)}` : 'Unterwegs',
        overdue: false,
      };

    case 'delivered': {
      const verb = order.deliveryType === 'pickup' ? 'Abgeholt' : 'Zugestellt';
      if (!order.closedMs) return { text: verb, overdue: false };
      const minutes = Math.max(0, Math.round((order.closedMs - order.createdMs) / 60_000));
      return { text: `${verb} ${posClock(order.closedMs)} · ${minutes} Min`, overdue: false };
    }

    case 'cancelled':
      return {
        text: order.closedMs ? `Storniert ${posClock(order.closedMs)}` : 'Storniert',
        overdue: false,
      };
  }
}

/**
 * Какие статусы базы попадают на какую вкладку.
 *
 * «Zubereitung» держит и непринятые, и готовые заказы: для кухни это всё ещё
 * работа на столе. Спрятать их за отдельными вкладками значило бы потерять
 * заказ, который никто не принял.
 */
export const POS_TAB_STATUSES: Record<string, PosBoardStatus[]> = {
  preparing: ['new', 'preparing', 'ready'],
  delivering: ['delivering'],
  delivered: ['delivered'],
  cancelled: ['cancelled'],
};
