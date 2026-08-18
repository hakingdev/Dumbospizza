'use client';

import { useMemo, useState } from 'react';
import { PosAppBar, PosStatusBar } from '../../../components/pos/primitives';
import {
  PosBottomNav,
  PosOrderCard,
  PosStatusTabs,
  type PosOrderSummary,
  type PosTab,
} from '../../../components/pos/order-list';
import { PosPauseBanner } from '../../../components/pos/kitchen';
import {
  POS_TAB_STATUSES,
  posClock,
  posCountdown,
  posFetch,
  posOrderMeta,
  posOrderNote,
  usePosBoard,
  usePosNow,
} from '../../../components/pos/data';
import { PosScreenState } from '../../../components/pos/screen-state';

/**
 * 03–06 · Bestellungen (Figma 11:54, 11:165, 11:266, 11:380) и
 * 14 · Betrieb pausiert (22:865).
 *
 * Четыре экрана макета — это один экран с четырьмя вкладками: шапка, табы,
 * лента и навигация у них общие, отличается только выборка. Пауза — не пятый
 * экран, а баннер над той же лентой: принятые заказы доготавливаются, и человек
 * должен видеть и их, и причину, по которой новых не появляется.
 *
 * Данные — `/api/pos/v1/board`, один запрос на все три вещи сразу (заказы,
 * счётчики, стоп): три отдельных показали бы ленту одной секунды со
 * счётчиками другой.
 */

const TAB_LABELS: { key: string; label: string }[] = [
  { key: 'preparing', label: 'Zubereitung' },
  { key: 'delivering', label: 'Unterwegs' },
  { key: 'delivered', label: 'Geliefert' },
  { key: 'cancelled', label: 'Storniert' },
];

export default function OrdersPage() {
  const { state, refresh, skewRef } = usePosBoard();
  const nowMs = usePosNow(skewRef);
  const [active, setActive] = useState('preparing');
  const [busy, setBusy] = useState(false);

  const board = state.status === 'ready' ? state.data : null;

  const tabs = useMemo<PosTab[]>(
    () =>
      TAB_LABELS.map(({ key, label }) => ({
        key,
        label,
        count: (POS_TAB_STATUSES[key] ?? []).reduce(
          (sum, status) => sum + (board?.counts[status] ?? 0),
          0
        ),
      })),
    [board]
  );

  const visible = useMemo<PosOrderSummary[]>(() => {
    if (!board || nowMs == null) return [];
    const wanted = new Set(POS_TAB_STATUSES[active] ?? []);
    return board.orders
      .filter((order) => wanted.has(order.status))
      .map((order) => {
        const note = posOrderNote(order, nowMs);
        return {
          id: order.id,
          number: order.number,
          status: order.status,
          meta: posOrderMeta(order),
          items: order.items,
          note: note.text,
          total: order.total,
          overdue: note.overdue,
        };
      });
  }, [board, active, nowMs]);

  /** Итог смены спрашивают только у закрытых вкладок: у текущих важен таймер. */
  const summary =
    board && active === 'delivered'
      ? { label: `${board.counts.delivered} Bestellungen heute`, value: board.dayTotal.delivered }
      : board && active === 'cancelled'
        ? { label: `${board.counts.cancelled} Stornos heute`, value: board.dayTotal.cancelled }
        : null;

  const pause = board?.pause ?? null;
  const pauseUntilMs = pause ? new Date(pause.untilIso).getTime() : null;

  const changeStop = async (minutes: number) => {
    if (!pause || busy) return;
    setBusy(true);
    await posFetch('/api/pos/v1/kitchen', {
      method: 'POST',
      body: JSON.stringify({ scope: pause.scope, minutes }),
    });
    await refresh();
    setBusy(false);
  };

  return (
    <>
      <PosStatusBar time={posClock(nowMs)} />
      <PosAppBar
        overline="DUMBO SLICE PIZZA & SUSHI"
        title="Bestellungen"
        action={{ icon: 'bell', label: 'Meldungen' }}
      />

      {pause && pauseUntilMs != null && nowMs != null && (
        <PosPauseBanner
          scope={pause.scope}
          untilLabel={posClock(pauseUntilMs)}
          reason={pause.scope === 'all' ? 'Küche überlastet' : 'Werkstatt gestoppt'}
          countdown={posCountdown(pauseUntilMs - nowMs)}
          // «+30» продлевает от ОСТАТКА, а не от нуля: иначе нажатие «ещё
          // полчаса» на стопе с 24 минутами укоротило бы паузу.
          onExtend={() =>
            changeStop(Math.max(0, Math.round((pauseUntilMs - nowMs) / 60_000)) + 30)
          }
          onRelease={() => changeStop(0)}
        />
      )}

      <PosStatusTabs tabs={tabs} active={active} onChange={setActive} />

      <div className="pos-scroll flex min-h-px w-full flex-1 flex-col gap-[12px] px-[16px] py-[14px]">
        {pause && (
          <span className="pos-overline w-full text-[var(--pos-text-muted)]">
            LAUFENDE BESTELLUNGEN WERDEN NORMAL FERTIGGESTELLT
          </span>
        )}

        {summary && (
          <div className="flex w-full items-center gap-[8px] rounded-[12px] bg-[var(--pos-bg-surface-2)] px-[12px] py-[10px]">
            <span className="pos-body-m text-[var(--pos-text-secondary)]">{summary.label}</span>
            <span className="h-px min-w-px flex-1" />
            <span className="pos-label-l pos-num text-[var(--pos-text-primary)]">
              {summary.value}
            </span>
          </div>
        )}

        <PosScreenState state={state} onRetry={refresh} />

        {visible.map((order) => (
          <PosOrderCard key={order.id} order={order} />
        ))}

        {/* Пустая вкладка — не ошибка, а нормальное состояние смены. */}
        {board && visible.length === 0 && (
          <p className="pos-body-m w-full pt-[24px] text-center text-[var(--pos-text-muted)]">
            Keine Bestellungen in diesem Status.
          </p>
        )}
      </div>

      <PosBottomNav active="orders" />
    </>
  );
}
