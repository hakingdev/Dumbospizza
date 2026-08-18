'use client';

import { useState } from 'react';
import { PosAppBar, PosStatusBar } from '../../../components/pos/primitives';
import { PosBottomNav } from '../../../components/pos/order-list';
import {
  POS_SCOPES_STATUS,
  PosScopeCard,
  type PosStopScope,
} from '../../../components/pos/kitchen';
import { PosScreenState } from '../../../components/pos/screen-state';
import {
  posClock,
  posSetStop,
  usePosKitchen,
  usePosNow,
} from '../../../components/pos/data';

/**
 * 13 · Küchen-Status (Steuerpult), Figma 33:884.
 *
 * Панель, на которую приходят с вопросом «почему не идут заказы» и с которой
 * уходят, нажав «Freigeben». Поэтому стоп и снятие живут на одной карточке с
 * состоянием, а не в разных местах.
 *
 * Пишет туда же, куда стоп-бот и админка (`/api/pos/v1/kitchen` поверх
 * `applyBlockAction`), поэтому снять стоп можно с любой из трёх сторон.
 */

export default function KitchenStatusPage() {
  const { state, refresh, skewRef } = usePosKitchen();
  const nowMs = usePosNow(skewRef, 30_000);
  const [busy, setBusy] = useState(false);

  const scopes = state.status === 'ready' ? state.data : [];

  /**
   * Глобальный стоп сильнее цехового: пока стоит весь приём, цех всё равно
   * ничего не отдаст. Показываем больший из двух сроков — так же, как это
   * делает `withGlobalBlock` для сообщения гостю.
   */
  const globalLeft = scopes.find((s) => s.scope === 'all')?.minutesLeft ?? 0;
  const leftFor = (scope: PosStopScope) => {
    const own = scopes.find((s) => s.scope === scope)?.minutesLeft ?? 0;
    return scope === 'all' ? own : Math.max(own, globalLeft);
  };

  const apply = async (scope: PosStopScope, minutes: number) => {
    if (busy) return;
    setBusy(true);
    await posSetStop(scope, minutes);
    await refresh();
    setBusy(false);
  };

  return (
    <>
      <PosStatusBar time={posClock(nowMs)} />
      <PosAppBar
        overline="DUMBO SLICE PIZZA & SUSHI"
        title="Küchen-Status"
        action={{ icon: 'bell', label: 'Meldungen' }}
      />

      <div className="pos-scroll flex min-h-px w-full flex-1 flex-col gap-[12px] px-[16px] pb-[14px] pt-[10px]">
        <PosScreenState state={state} onRetry={refresh} />

        {POS_SCOPES_STATUS.map((scope) => (
          <PosScopeCard
            key={scope}
            scope={scope}
            minutesLeft={leftFor(scope)}
            onStop={(minutes) => apply(scope, minutes)}
            // «+30» считается от ОСТАТКА: иначе «ещё полчаса» на стопе с 40
            // минутами укоротило бы паузу вместо продления.
            onExtend={() => apply(scope, leftFor(scope) + 30)}
            // Снятие чистит только свой срок. У цеха при активном глобальном
            // стопе он останется стоять — это видно по карточке «Alles».
            onRelease={() => apply(scope, 0)}
          />
        ))}

        <p className="pos-body-s w-full text-[var(--pos-text-muted)]">
          Dieselbe Steuerung gibt es im Telegram-Bot: /start → Küche → Blockieren.
        </p>
      </div>

      <PosBottomNav active="more" />
    </>
  );
}
