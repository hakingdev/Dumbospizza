"use client";

/**
 * Стоп цеха на витрине: гость должен понять ещё В МЕНЮ, что этой категории
 * сейчас нет, а не на чекауте с полной корзиной.
 *
 * Один запрос GET /api/kitchen/blocks на всё приложение (обновление раз в
 * минуту) + модалка с объяснением: что закрыто, на сколько минут и что можно
 * заказать вместо этого. Карточки товара, страница товара и чекаут читают
 * состояние отсюда — правило «какая позиция к какому цеху» живёт в одном месте.
 *
 * Тот же опрос несёт время продажи категорий (бургеры только 17–22): окна
 * считает сервер, поэтому в 17:00 серые карточки оживают сами, без перезагрузки.
 *
 * И стоп-лист позиций/размеров (стоп-бот, админка, POS): корзина живёт в
 * браузере сутки, строку, выключенную ПОСЛЕ её добавления, иначе отклонил бы
 * только сервер при оформлении. Правило — lib/menu-stop/sold-out.ts.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  EMPTY_WORKSHOP_BLOCKS,
  WORKSHOPS,
  WORKSHOP_BLOCK_HEADLINE,
  buildWorkshopBadge,
  buildWorkshopBlockMessage,
  classifyWorkshop,
  withGlobalBlock,
  type WorkshopBlocks,
  type WorkshopId,
} from '../kitchen/workshops';
import {
  EMPTY_CATEGORY_HOURS,
  availabilityBadge,
  scheduleClosureFor as findScheduleClosure,
  type CategoryHours,
  type CategoryWindow,
} from '../categories/availability';
import {
  EMPTY_SOLD_OUT,
  isProductSoldOut as productSoldOutIn,
  isSizeInactive as sizeInactiveIn,
  soldOutLinesIn as findSoldOutLines,
  soldOutReasonFor as findSoldOutReason,
  type SoldOutLine,
  type SoldOutLineItem,
  type SoldOutReason,
  type SoldOutSnapshot,
} from '../menu-stop/sold-out';

export interface BlockableItem {
  categoryId?: string | null;
  subcategoryId?: string | null;
  name?: string;
}

interface KitchenBlocksValue {
  /** Остановленные прямо сейчас цеха ([] — работает всё). */
  blockedWorkshops: WorkshopId[];
  /** Цех позиции, ЕСЛИ он остановлен; иначе null. */
  blockedWorkshopFor: (item: BlockableItem) => WorkshopId | null;
  /** Остановленные цеха, задетые набором позиций (корзина). */
  blockedWorkshopsForItems: (items: BlockableItem[]) => WorkshopId[];
  /** Полный текст гостю (с минутами и подсказкой, что заказать вместо). */
  messageFor: (ids: WorkshopId[]) => string;
  /** Короткая плашка для карточки: «MakiLove (Sushi) · noch 20 Min». */
  badgeFor: (ids: WorkshopId[]) => string;
  /** Показать модалку с объяснением (клик по закрытому товару). */
  showNotice: (ids: WorkshopId[]) => void;
  /** Окно категории/подкатегории позиции, если оно СЕЙЧАС закрыто; иначе null. */
  scheduleClosureFor: (item: BlockableItem) => CategoryWindow | null;
  /** Закрытые окна, задетые набором позиций (корзина), без повторов. */
  scheduleClosuresForItems: (items: BlockableItem[]) => CategoryWindow[];
  /** Модалка «когда можно заказать» (клик по серой карточке). */
  showScheduleNotice: (window: CategoryWindow) => void;
  /** Товар снят с продажи (products.available=false) — стоп-бот/админка/POS. */
  isProductSoldOut: (productId: string) => boolean;
  /** Размер библиотеки выключен (сравнение через normalizedSizeName). */
  isSizeInactive: (sizeName: string) => boolean;
  /** Почему строку корзины нельзя заказать; null — можно. */
  soldOutReasonFor: (item: SoldOutLineItem) => SoldOutReason | null;
  /** Строки корзины, которые сервер отклонит (товар снят или размер выключен). */
  soldOutLinesIn: <T extends SoldOutLineItem>(items: readonly T[]) => SoldOutLine<T>[];
}

const NOOP_VALUE: KitchenBlocksValue = {
  blockedWorkshops: [],
  blockedWorkshopFor: () => null,
  blockedWorkshopsForItems: () => [],
  messageFor: () => '',
  badgeFor: () => '',
  showNotice: () => {},
  scheduleClosureFor: () => null,
  scheduleClosuresForItems: () => [],
  showScheduleNotice: () => {},
  isProductSoldOut: () => false,
  isSizeInactive: () => false,
  soldOutReasonFor: () => null,
  soldOutLinesIn: () => [],
};

const KitchenBlocksContext = createContext<KitchenBlocksValue>(NOOP_VALUE);

/** Вне провайдера (тесты, отдельные страницы) — всё открыто, ничего не ломается. */
export function useKitchenBlocks(): KitchenBlocksValue {
  return useContext(KitchenBlocksContext);
}

const REFRESH_MS = 60_000;

interface BlocksState {
  blockedWorkshops: WorkshopId[];
  blockedCategories: Record<string, WorkshopId>;
  blocks: WorkshopBlocks;
  /** Глобальный стоп приёма ('' — приём открыт). Он сильнее цехов. */
  ordersBlockedUntil: string;
  messageTemplate: string | null;
  categoryHours: CategoryHours;
  /** Стоп-лист позиций и размеров (все, не только выключенные ботом). */
  soldOut: SoldOutSnapshot;
}

const EMPTY_STATE: BlocksState = {
  blockedWorkshops: [],
  blockedCategories: {},
  blocks: { ...EMPTY_WORKSHOP_BLOCKS },
  ordersBlockedUntil: '',
  messageTemplate: null,
  categoryHours: EMPTY_CATEGORY_HOURS,
  soldOut: EMPTY_SOLD_OUT,
};

export function KitchenBlocksProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BlocksState>(EMPTY_STATE);
  // Тик, чтобы «noch N Minuten» пересчитывалось само (не только при ответе API).
  const [now, setNow] = useState<Date>(() => new Date());
  const [notice, setNotice] = useState<WorkshopId[] | null>(null);
  const [scheduleNotice, setScheduleNotice] = useState<CategoryWindow | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch('/api/kitchen/blocks', { cache: 'no-store' });
        const data = await response.json();
        if (cancelled || !data?.success) return;
        setState({
          blockedWorkshops: data.blockedWorkshops || [],
          blockedCategories: data.blockedCategories || {},
          blocks: { ...EMPTY_WORKSHOP_BLOCKS, ...(data.blocks || {}) },
          ordersBlockedUntil: data.ordersBlockedUntil || '',
          messageTemplate: data.messageTemplate || null,
          categoryHours: {
            categories: data.categoryHours?.categories || {},
            subcategories: data.categoryHours?.subcategories || {},
          },
          soldOut: {
            soldOutProductIds: Array.isArray(data.soldOutProductIds)
              ? data.soldOutProductIds.map(String)
              : [],
            inactiveSizeKeys: Array.isArray(data.inactiveSizeKeys)
              ? data.inactiveSizeKeys.map(String)
              : [],
          },
        });
        setNow(new Date());
      } catch (error) {
        console.error('Error loading kitchen blocks:', error);
      }
    };

    load();
    const interval = setInterval(() => {
      setNow(new Date());
      load();
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const blockedWorkshopFor = useCallback(
    (item: BlockableItem): WorkshopId | null => {
      if (state.blockedWorkshops.length === 0) return null;
      // Категория известна — верим списку сервера. По названию классифицируем
      // ТОЛЬКО позиции без категории, иначе «California Klassik» (в названии нет
      // слова sushi) уехала бы в цех пиццы.
      const workshop = item.categoryId
        ? state.blockedCategories[item.categoryId] || null
        : classifyWorkshop({ name: item.name });
      return workshop && state.blockedWorkshops.includes(workshop) ? workshop : null;
    },
    [state]
  );

  const scheduleClosureFor = useCallback(
    (item: BlockableItem) => findScheduleClosure(item, state.categoryHours),
    [state.categoryHours]
  );

  const soldOutReasonFor = useCallback(
    (item: SoldOutLineItem) => findSoldOutReason(state.soldOut, item),
    [state.soldOut]
  );

  const value = useMemo<KitchenBlocksValue>(() => {
    // Стоит и весь приём, и цех → срок берём поздний, иначе обещаем «через 10
    // минут», когда цех стоит 30.
    const effectiveBlocks = withGlobalBlock(state.blocks, state.ordersBlockedUntil);

    const messageFor = (ids: WorkshopId[]) =>
      ids.length === 0
        ? ''
        : buildWorkshopBlockMessage(ids, {
            blocks: effectiveBlocks,
            now,
            template: state.messageTemplate,
          });

    return {
      blockedWorkshops: state.blockedWorkshops,
      blockedWorkshopFor,
      blockedWorkshopsForItems: (items: BlockableItem[]) => {
        const hit = new Set<WorkshopId>();
        for (const item of items || []) {
          const workshop = blockedWorkshopFor(item);
          if (workshop) hit.add(workshop);
        }
        return state.blockedWorkshops.filter((id) => hit.has(id));
      },
      messageFor,
      badgeFor: (ids: WorkshopId[]) =>
        ids.length === 0 ? '' : buildWorkshopBadge(ids, effectiveBlocks, now),
      showNotice: (ids: WorkshopId[]) => {
        if (ids.length > 0) setNotice(ids);
      },
      scheduleClosureFor,
      scheduleClosuresForItems: (items: BlockableItem[]) => {
        const hit: CategoryWindow[] = [];
        for (const item of items || []) {
          const window = scheduleClosureFor(item);
          if (window && !hit.includes(window)) hit.push(window);
        }
        return hit;
      },
      showScheduleNotice: setScheduleNotice,
      isProductSoldOut: (productId: string) => productSoldOutIn(state.soldOut, productId),
      isSizeInactive: (sizeName: string) => sizeInactiveIn(state.soldOut, sizeName),
      soldOutReasonFor,
      soldOutLinesIn: <T extends SoldOutLineItem>(items: readonly T[]) =>
        findSoldOutLines(state.soldOut, items),
    };
  }, [state, now, blockedWorkshopFor, scheduleClosureFor, soldOutReasonFor]);

  return (
    <KitchenBlocksContext.Provider value={value}>
      {children}
      {notice && (
        <BlockedNoticeModal
          title={notice.map((id) => WORKSHOPS[id].de).join(' + ')}
          message={value.messageFor(notice)}
          onClose={() => setNotice(null)}
        />
      )}
      {scheduleNotice && (
        <ScheduleNoticeModal window={scheduleNotice} onClose={() => setScheduleNotice(null)} />
      )}
    </KitchenBlocksContext.Provider>
  );
}

function BlockedNoticeModal({
  title,
  message,
  onClose,
}: {
  title: string;
  message: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start gap-3">
          <span className="text-3xl leading-none" aria-hidden="true">
            ⏸️
          </span>
          <div>
            <h2 className="text-lg font-bold text-gray-900">{WORKSHOP_BLOCK_HEADLINE}</h2>
            <p className="text-sm font-medium text-gray-500">{title}</p>
          </div>
        </div>
        <p className="mb-6 text-sm leading-6 text-gray-700">{message}</p>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] w-full rounded-lg bg-primary-600 px-4 py-3 font-medium text-white transition-colors hover:bg-primary-700"
        >
          Verstanden
        </button>
      </div>
    </div>
  );
}

/** «Burger — Erhältlich ab 17:00» + недельный график категории. */
function ScheduleNoticeModal({ window, onClose }: { window: CategoryWindow; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start gap-3">
          <span className="text-3xl leading-none" aria-hidden="true">
            🕒
          </span>
          <div>
            <h2 className="text-lg font-bold text-gray-900">{availabilityBadge(window)}</h2>
            <p className="text-sm font-medium text-gray-500">{window.name}</p>
          </div>
        </div>
        {window.lines.length > 0 && (
          <div className="mb-6">
            <p className="mb-1 text-sm leading-6 text-gray-700">Bestellbar:</p>
            <ul className="text-sm leading-6 text-gray-900">
              {window.lines.map((line) => (
                <li key={line} className="tabular-nums">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] w-full rounded-lg bg-primary-600 px-4 py-3 font-medium text-white transition-colors hover:bg-primary-700"
        >
          Verstanden
        </button>
      </div>
    </div>
  );
}
