'use client';

import Link from 'next/link';
import { PosStatusBar } from '../../../components/pos/primitives';
import { PosBottomNav } from '../../../components/pos/order-list';
import { PosCategoryRow } from '../../../components/pos/menu';
import { POS_SCOPE_META } from '../../../components/pos/kitchen';
import { PosScreenState } from '../../../components/pos/screen-state';
import { posClock, usePosKitchen, usePosMenu, usePosNow } from '../../../components/pos/data';

/**
 * 09 · Speisekarte · Kategorien (Figma 15:479).
 *
 * Экран, куда приходят, когда что-то кончилось. Поэтому наверху — не поиск ради
 * поиска, а состояние кухни: работает ли цех и сколько позиций сейчас погашено.
 */

export default function MenuPage() {
  const { state, refresh, skewRef } = usePosMenu();
  const { state: kitchenState } = usePosKitchen();
  const nowMs = usePosNow(skewRef, 30_000);

  const categories = state.status === 'ready' ? state.data : [];
  const stoppedTotal = categories.reduce((sum, c) => sum + c.stoppedCount, 0);

  /** Самый долгий из активных стопов — о нём и говорит плашка наверху. */
  const stop =
    kitchenState.status === 'ready'
      ? kitchenState.data
          .filter((scope) => scope.minutesLeft > 0)
          .sort((a, b) => b.minutesLeft - a.minutesLeft)[0]
      : undefined;

  return (
    <>
      <PosStatusBar time={posClock(nowMs)} />

      <header className="flex h-[56px] w-full shrink-0 items-center gap-[8px] bg-[var(--pos-bg-base)] py-[6px] pl-[16px] pr-[4px]">
        <span className="pos-title-m text-[var(--pos-text-primary)]">Speisekarte</span>
      </header>

      <div className="pos-scroll flex min-h-px w-full flex-1 flex-col gap-[12px] px-[16px] pb-[14px] pt-[6px]">
        <PosScreenState state={state} onRetry={refresh} />

        {stop && (
          <div className="flex w-full items-center gap-[8px] rounded-[12px] bg-[var(--pos-tint-preparing)] px-[12px] py-[10px]">
            <span className="pos-body-s text-[var(--pos-status-preparing)]">
              {POS_SCOPE_META[stop.scope].title} · noch {stop.minutesLeft} Min
            </span>
            <span className="h-px min-w-px flex-1" />
            <Link href="/pos/kitchen" className="pos-body-s text-[var(--pos-accent)] underline">
              Ändern
            </Link>
          </div>
        )}

        <div className="flex w-full gap-[10px]">
          <Link
            href="/pos/kitchen/stop"
            className="pos-label-m flex h-[50px] min-w-px flex-1 items-center justify-center rounded-[12px] border border-[var(--pos-border)] bg-[var(--pos-bg-surface)] text-[var(--pos-text-primary)]"
          >
            Küche stoppen
          </Link>
          <Link
            href="/pos/kitchen"
            className="pos-label-m flex h-[50px] min-w-px flex-1 items-center justify-center rounded-[12px] border border-[var(--pos-border)] bg-[var(--pos-bg-surface)] text-[var(--pos-text-primary)]"
          >
            Stop-Liste {stoppedTotal}
          </Link>
        </div>

        {categories.map((category) => (
          <PosCategoryRow key={category.id} category={category} />
        ))}

        {state.status === 'ready' && categories.length === 0 && (
          <p className="pos-body-m w-full pt-[24px] text-center text-[var(--pos-text-muted)]">
            Keine Kategorien vorhanden.
          </p>
        )}
      </div>

      <PosBottomNav active="menu" />
    </>
  );
}
