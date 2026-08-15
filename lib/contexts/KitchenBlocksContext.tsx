"use client";

/**
 * Стоп цеха на витрине: гость должен понять ещё В МЕНЮ, что этой категории
 * сейчас нет, а не на чекауте с полной корзиной.
 *
 * Один запрос GET /api/kitchen/blocks на всё приложение (обновление раз в
 * минуту) + модалка с объяснением: что закрыто, на сколько минут и что можно
 * заказать вместо этого. Карточки товара, страница товара и чекаут читают
 * состояние отсюда — правило «какая позиция к какому цеху» живёт в одном месте.
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

export interface BlockableItem {
  categoryId?: string | null;
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
}

const NOOP_VALUE: KitchenBlocksValue = {
  blockedWorkshops: [],
  blockedWorkshopFor: () => null,
  blockedWorkshopsForItems: () => [],
  messageFor: () => '',
  badgeFor: () => '',
  showNotice: () => {},
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
}

const EMPTY_STATE: BlocksState = {
  blockedWorkshops: [],
  blockedCategories: {},
  blocks: { ...EMPTY_WORKSHOP_BLOCKS },
  ordersBlockedUntil: '',
  messageTemplate: null,
};

export function KitchenBlocksProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BlocksState>(EMPTY_STATE);
  // Тик, чтобы «noch N Minuten» пересчитывалось само (не только при ответе API).
  const [now, setNow] = useState<Date>(() => new Date());
  const [notice, setNotice] = useState<WorkshopId[] | null>(null);

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
    };
  }, [state, now, blockedWorkshopFor]);

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
