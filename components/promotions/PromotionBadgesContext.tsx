"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Бейджи акций для СПИСКА карточек — одним запросом.
 *
 * Было: каждая карточка сама дёргала GET /api/promotions/product/[id], причём
 * дважды (бейдж + цена). Категория на ~90 товаров = ~180 параллельных вызовов,
 * каждый со своим `select * from promotions`. При пуле в 3 соединения на инстанс
 * (lib/db/client.ts) они выстраивались в очередь — отсюда «долго грузится
 * с пустыми полями».
 *
 * Стало: страница со списком оборачивается в <PromotionBadgesProvider items={…}>,
 * который делает ОДИН POST /api/promotions/badges на весь список. Карточка вне
 * провайдера (модалка товара, страница товара) продолжает работать сама по себе —
 * там это один запрос, а не сотня.
 */

export type PromoBadge = {
  promotionId: string;
  badgeText: string;
  name: string;
  type?: string;
  percentValue?: number;
  fixedValue?: number;
  bogoMode?: string;
  validTo?: string;
  scheduleLabel?: string;
  happyHourActive?: boolean;
};

export type BadgeItem = { productId: string; categoryId?: string };

type BadgeMap = Record<string, PromoBadge[]>;
type ContextValue = { badges: BadgeMap; loaded: boolean };

const PromotionBadgesContext = createContext<ContextValue | null>(null);

const EMPTY_BADGES: PromoBadge[] = [];

/**
 * /api/products отдаёт категорию ПОПУЛИРОВАННЫМ объектом, а не строкой. Раньше
 * объект уходил прямо в URLSearchParams и превращался в "[object Object]",
 * поэтому акции, нацеленные на КАТЕГОРИЮ, не давали бейдж на карточках каталога.
 */
export function readCategoryId(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const id = obj._id ?? obj.id;
    if (typeof id === 'string' && id) return id;
  }
  return undefined;
}

/** Ответ живёт минуту: возврат в ту же категорию не бьёт по сети заново. */
const CACHE_TTL_MS = 60_000;
const responseCache = new Map<string, { badges: BadgeMap; at: number }>();

function cacheKey(items: BadgeItem[]): string {
  return items
    .map((i) => `${i.productId}:${i.categoryId ?? ''}`)
    .sort()
    .join(',');
}

function readCache(key: string): BadgeMap | undefined {
  const hit = responseCache.get(key);
  if (!hit || Date.now() - hit.at >= CACHE_TTL_MS) return undefined;
  return hit.badges;
}

/** Одинаковые списки, запрошенные одновременно, склеиваем в один запрос. */
const inflight = new Map<string, Promise<BadgeMap>>();

async function postBadges(items: BadgeItem[]): Promise<BadgeMap> {
  const response = await fetch('/api/promotions/badges', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  const data = await response.json();
  return data?.success ? ((data.badges || {}) as BadgeMap) : {};
}

function fetchBadges(items: BadgeItem[], key = cacheKey(items)): Promise<BadgeMap> {
  const pending = inflight.get(key);
  if (pending) return pending;

  const request = postBadges(items).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, request);
  return request;
}

export function PromotionBadgesProvider({
  items,
  children,
}: {
  items: BadgeItem[];
  children: React.ReactNode;
}) {
  const key = useMemo(() => cacheKey(items), [items]);
  // Запрос перезапускается по ключу списка, а не по ссылке на массив —
  // иначе каждый ре-рендер страницы слал бы новый POST.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const [state, setState] = useState<ContextValue>(() => {
    const cached = key ? readCache(key) : undefined;
    return cached ? { badges: cached, loaded: true } : { badges: {}, loaded: false };
  });

  useEffect(() => {
    if (!key) {
      setState({ badges: {}, loaded: true });
      return;
    }

    const cached = readCache(key);
    if (cached) {
      setState({ badges: cached, loaded: true });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ badges: prev.badges, loaded: false }));

    fetchBadges(itemsRef.current, key)
      .then((badges) => {
        responseCache.set(key, { badges, at: Date.now() });
        if (!cancelled) setState({ badges, loaded: true });
      })
      .catch(() => {
        // Без бейджей карточка остаётся корректной — показывает базовую цену.
        if (!cancelled) setState({ badges: {}, loaded: true });
      });

    return () => {
      cancelled = true;
    };
  }, [key]);

  return (
    <PromotionBadgesContext.Provider value={state}>{children}</PromotionBadgesContext.Provider>
  );
}

/**
 * Бейджи одного товара. Внутри провайдера — из общего ответа (0 запросов),
 * снаружи — собственный запрос на один товар.
 */
export function useProductBadges(
  productId: string,
  categoryId?: string
): { badges: PromoBadge[]; loaded: boolean } {
  const shared = useContext(PromotionBadgesContext);
  const standalone = shared === null;
  const [own, setOwn] = useState<ContextValue>({ badges: {}, loaded: false });

  useEffect(() => {
    if (!standalone || !productId) return;

    let cancelled = false;
    setOwn({ badges: {}, loaded: false });

    fetchBadges([{ productId, categoryId }])
      .then((badges) => {
        if (!cancelled) setOwn({ badges, loaded: true });
      })
      .catch(() => {
        if (!cancelled) setOwn({ badges: {}, loaded: true });
      });

    return () => {
      cancelled = true;
    };
  }, [standalone, productId, categoryId]);

  const source = shared ?? own;
  return { badges: source.badges[productId] || EMPTY_BADGES, loaded: source.loaded };
}

/** Список для провайдера из массива товаров /api/products. */
export function toBadgeItems(
  products: Array<{ _id?: string; id?: string; category?: unknown; categoryId?: unknown }>
): BadgeItem[] {
  const items: BadgeItem[] = [];
  for (const product of products) {
    const productId = product._id || product.id;
    if (!productId) continue;
    items.push({
      productId: String(productId),
      categoryId: readCategoryId(product.categoryId ?? product.category),
    });
  }
  return items;
}
