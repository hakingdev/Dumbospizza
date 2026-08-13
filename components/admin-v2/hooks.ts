'use client';

/** Дата-хуки портала: тонкие обёртки над существующими API. */

import { useCallback, useEffect, useRef, useState } from 'react';

type FetchState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Время последней УСПЕШНОЙ загрузки — для «показаны данные на HH:MM». */
  updatedAt: number | null;
  reload: () => void;
};

/**
 * Правила для страниц: error && !data — данные не загрузились вовсе,
 * рендерить <LoadError> вместо контента; error && data — фон-обновление
 * упало, показывать данные + <ErrorBanner>. «0 заказов» без загруженного
 * data — ложь, а не факт.
 */
export function useJson<T = any>(url: string | null, intervalMs?: number): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const aliveRef = useRef(true);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    aliveRef.current = true;
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const fail = (message: string) => {
      setError(message);
      console.error(`[admin-v2] Не загрузилось ${url}: ${message}`);
    };
    const run = async (silent: boolean) => {
      if (!silent) setLoading(true);
      // Зависший запрос — тоже ошибка: 20 с и показываем «Повторить»
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 20_000);
      try {
        const res = await fetch(url, { cache: 'no-store', signal: abort.signal });
        const json = await res.json().catch(() => null);
        if (cancelled || !aliveRef.current) return;
        if (!res.ok || json?.success === false) {
          fail(json?.error || `HTTP ${res.status}`);
        } else if (json === null) {
          fail('Некорректный ответ сервера');
        } else {
          setData(json);
          setError(null);
          setUpdatedAt(Date.now());
        }
      } catch (e: any) {
        if (!cancelled && aliveRef.current) {
          fail(e?.name === 'AbortError' ? 'Сервер не ответил за 20 секунд' : e?.message || 'Network error');
        }
      } finally {
        clearTimeout(timeout);
        if (!cancelled && aliveRef.current) setLoading(false);
      }
    };
    run(false);
    let timer: ReturnType<typeof setInterval> | undefined;
    if (intervalMs) {
      timer = setInterval(() => run(true), intervalMs);
    }
    return () => {
      cancelled = true;
      aliveRef.current = false;
      if (timer) clearInterval(timer);
    };
  }, [url, tick, intervalMs]);

  return { data, loading, error, updatedAt, reload };
}

/* ---- Заказы ---- */

export type AdminOrder = {
  _id: string;
  orderNumber: string;
  customerName: string;
  phoneNumber: string;
  items: {
    product?: string;
    name: string;
    quantity: number;
    price: number;
    size?: string;
    toppings?: { name: string; price?: number }[];
    label?: string;
  }[];
  deliveryAddress?: {
    street?: string;
    houseNumber?: string;
    postalCode?: string;
    city?: string;
    floor?: string;
    notes?: string;
  };
  deliveryZone?: { id: string; name: string; minOrderAmount?: number };
  deliveryType: 'delivery' | 'pickup';
  deliveryFee: number;
  subtotal: number;
  discount?: { code?: string; amount: number; type: string };
  promotionDiscount?: number;
  promotionPromoCode?: string;
  total: number;
  paymentMethod: 'cash' | 'card' | 'online';
  paymentStatus: 'pending' | 'completed' | 'failed';
  status: string;
  notes?: string;
  desiredDeliveryTime?: string;
  etaMinutes?: number;
  /** Канал: 'website' — наш сайт, 'lieferando' — чек Lieferando (чужая касса). */
  source?: 'website' | 'lieferando';
  createdAt: string;
  statusUpdates?: { status: string; timestamp: string }[];
};

export const ACTIVE_STATUSES = ['new', 'preparing', 'ready_for_delivery', 'delivering'];

/**
 * Лента заказов. ВАЖНО: API принимает только ОДИН статус (список через
 * запятую не работает — см. visibleOrderStatusFilter), поэтому вкладки
 * фильтруются на клиенте по загруженной странице, как в старой админке.
 */
export function useOrdersFeed(params: { limit?: number; page?: number; status?: string }, pollMs?: number) {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  search.set('limit', String(params.limit ?? 100));
  if (params.page) search.set('page', String(params.page));
  const state = useJson<{ orders: AdminOrder[]; pagination: { total: number; pages: number } }>(
    `/api/orders?${search.toString()}`,
    pollMs
  );
  return {
    ...state,
    orders: state.data?.orders ?? [],
    total: state.data?.pagination?.total ?? 0,
  };
}

export async function updateOrderStatus(
  orderId: string,
  status: string,
  extra?: { notes?: string }
): Promise<boolean> {
  try {
    const res = await fetch(`/api/orders/${orderId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, ...(extra || {}) }),
    });
    const json = await res.json();
    return res.ok && json?.success !== false;
  } catch {
    return false;
  }
}

/** Повторная печать кухонного чека (очередь принт-агента, seq+1). */
export async function reprintOrder(orderId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/orders/${orderId}/reprint`, { method: 'POST' });
    const json = await res.json();
    return res.ok && json?.success !== false;
  } catch {
    return false;
  }
}

/** Следующее действие по заказу — цепочка статусов из дизайна D2. */
export function nextOrderAction(status: string):
  | { label: string; next: string; tone: 'primary' | 'success' | 'soft' }
  | null {
  switch (status) {
    case 'new':
      return { label: 'Принять', next: 'preparing', tone: 'primary' };
    case 'preparing':
      return { label: 'Заказ готов', next: 'ready_for_delivery', tone: 'success' };
    case 'ready_for_delivery':
      return { label: 'Передать курьеру', next: 'delivering', tone: 'soft' };
    case 'delivering':
      return { label: 'Завершить', next: 'completed', tone: 'success' };
    default:
      return null;
  }
}

/* ---- Настройки магазина ---- */

export type StoreSettings = Record<string, any>;

export function useStoreSettings() {
  const state = useJson<{ settings: StoreSettings }>(`/api/settings/store`);
  return { ...state, settings: state.data?.settings ?? null };
}

/**
 * Частичное обновление storeSettings: POST заменяет весь объект,
 * поэтому мержим поверх свежего GET.
 */
export async function patchStoreSettings(patch: StoreSettings): Promise<boolean> {
  try {
    const res = await fetch('/api/settings/store', { cache: 'no-store' });
    const json = await res.json().catch(() => null);
    const current = json?.settings;
    // Без свежей копии сохранять нельзя: POST заменяет ВЕСЬ объект,
    // и мерж с пустотой стёр бы остальные настройки магазина.
    if (!res.ok || !current) return false;
    const save = await fetch('/api/settings/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...current, ...patch }),
    });
    const saved = await save.json();
    return save.ok && saved?.success !== false;
  } catch {
    return false;
  }
}

/* ---- Меню ---- */

export type AdminCategory = {
  _id: string;
  name: string;
  slug?: string;
  order?: number;
  active?: boolean;
};

export type AdminProduct = {
  _id: string;
  name: string;
  description?: string;
  /** Каноническое поле цены в модели — basePrice (price — легаси-алиас). */
  basePrice?: number;
  price?: number;
  image?: string;
  category?: { _id: string; name: string } | string;
  subcategory?: string;
  available: boolean;
  featured?: boolean;
  taxRate?: number;
  sizes?: {
    id: string;
    variationId?: string;
    name: string;
    label?: string;
    price: number;
    active?: boolean;
  }[];
  optionGroupIds?: (string | { _id: string })[];
};

export function productBasePrice(product: AdminProduct): number {
  return Number(product.basePrice ?? product.price) || 0;
}

export function useCategories() {
  const state = useJson<{ categories: AdminCategory[] }>(`/api/categories`);
  return { ...state, categories: state.data?.categories ?? [] };
}

export function useProducts() {
  // limit=1000 — админ-выборка всего меню, как в старой админке
  const state = useJson<any>(`/api/products?limit=1000`);
  const raw = state.data;
  const products: AdminProduct[] = raw?.products ?? raw?.data ?? [];
  return { ...state, products };
}

export async function setProductAvailability(productId: string, available: boolean): Promise<boolean> {
  try {
    const res = await fetch(`/api/products/${productId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ available }),
    });
    const json = await res.json();
    return res.ok && json?.success !== false;
  } catch {
    return false;
  }
}

/* ---- Опции (добавки) ---- */

export type AdminOption = {
  _id: string;
  name: string;
  price: number;
  active: boolean;
};

export type AdminOptionGroup = {
  _id: string;
  name: string;
  optionIds: (string | { _id: string })[];
  active: boolean;
};

export function useOptions() {
  const state = useJson<{ options: AdminOption[] }>(`/api/options`);
  return { ...state, options: state.data?.options ?? [] };
}

export function useOptionGroups() {
  const state = useJson<{ groups: AdminOptionGroup[] }>(`/api/option-groups`);
  return { ...state, groups: state.data?.groups ?? [] };
}

export async function setOptionActive(optionId: string, active: boolean): Promise<boolean> {
  try {
    const res = await fetch(`/api/options/${optionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    });
    const json = await res.json();
    return res.ok && json?.success !== false;
  } catch {
    return false;
  }
}

/* ---- Зоны доставки ---- */

export type AdminZone = {
  _id: string;
  name: string;
  deliveryFee: number;
  minOrderAmount: number;
  maxDistance?: number;
  sortOrder?: number;
  freeDeliveryThreshold?: number | null;
  active: boolean;
};

export function useDeliveryZones() {
  const state = useJson<{ zones: AdminZone[] }>(`/api/delivery-zones?all=1`);
  return { ...state, zones: state.data?.zones ?? [] };
}

/** PUT зоны перезаписывает все поля — отправляем зону целиком. */
export async function saveDeliveryZone(zone: AdminZone): Promise<boolean> {
  try {
    const res = await fetch(`/api/delivery-zones/${zone._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(zone),
    });
    const json = await res.json();
    return res.ok && json?.success !== false;
  } catch {
    return false;
  }
}

/* ---- Статистика ---- */

export function useAdminStats(pollMs?: number, days?: number) {
  const state = useJson<{
    stats: {
      totalOrders: number;
      totalProducts: number;
      totalCategories: number;
      pendingOrders: number;
      todayOrders: number;
      todaySales: number;
    };
    /** getDailySales(days=7): суммы дня в totalSales, число заказов — count. */
    salesData: { date: string; totalSales: number; count: number }[];
  }>(days ? `/api/admin/stats?days=${days}` : `/api/admin/stats`, pollMs);
  return { ...state, stats: state.data?.stats ?? null, salesData: state.data?.salesData ?? [] };
}

/* ---- Маркетинг ---- */

export function usePromotions() {
  const state = useJson<{ promotions: any[] }>(`/api/promotions?admin=1`);
  return { ...state, promotions: state.data?.promotions ?? [] };
}

export function useCoupons() {
  const state = useJson<{ coupons: any[] }>(`/api/coupons`);
  return { ...state, coupons: state.data?.coupons ?? [] };
}
