'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  PosActionBar,
  PosAppBar,
  PosButton,
  PosStatusBar,
  PosStepButton,
  PosTimeChip,
} from '../../../../../components/pos/primitives';
import { PosScreenState } from '../../../../../components/pos/screen-state';
import {
  posClock,
  posFetch,
  usePosNow,
  usePosOrder,
} from '../../../../../components/pos/data';
import { toOrderStatus } from '../../../../../lib/pos/board';

/**
 * 02 · Zeit festlegen (Figma 10:18).
 *
 * Второй шаг приёма: сколько времени кухня просит на заказ. Ответ уезжает гостю,
 * поэтому промах ценой в полчаса дороже лишнего касания — отсюда и крупный
 * стрелочный шаг ±5, и пресеты, и подтверждение с временем прямо на кнопке.
 *
 * Пресеты названы «aus der Küche»: это те же значения, которыми оперирует
 * стоп-бот, а не произвольный набор.
 *
 * Подтверждение делает ровно одно обращение — PUT /api/orders/[id] со статусом
 * и `etaMinutes`. Раньше поставить ПЕРВОЕ обещание было нечем: существовал
 * только POST .../delay, который сдвигает уже назначенное.
 */

const PRESETS = [30, 45, 60, 90, 120] as const;
const STEP = 5;
const MIN_MINUTES = 5;
const MAX_MINUTES = 180;

function SetTimeScreen() {
  const router = useRouter();
  const search = useSearchParams();
  const orderId = search.get('id');
  const { state, refresh, skewRef } = usePosOrder(orderId);
  const nowMs = usePosNow(skewRef, 15_000);

  const [minutes, setMinutes] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const order = state.status === 'ready' ? state.data : null;

  /** Время готовности = время СЕРВЕРА + minutes: часы прибора могут уехать. */
  const target = useMemo(
    () => (nowMs == null ? '—' : posClock(nowMs + minutes * 60_000)),
    [nowMs, minutes]
  );
  const clamp = (v: number) => Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, v));

  /**
   * Принять заказ = назначить обещание и перевести в «готовится». Одним PUT,
   * а не двумя запросами: иначе между ними существует заказ, принятый без
   * времени, — ровно то состояние, которого экран и пытается не допустить.
   */
  const accept = async () => {
    if (!orderId || busy) return;
    setBusy(true);
    setError(null);
    const result = await posFetch(`/api/orders/${orderId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: toOrderStatus('preparing'), etaMinutes: minutes }),
    });
    setBusy(false);
    if (result.ok) router.push(`/pos/orders/${orderId}`);
    else setError(result.unauthorized ? 'Nicht angemeldet' : result.error || 'Fehlgeschlagen');
  };

  return (
    <>
      <PosStatusBar time={posClock(nowMs)} />
      <PosAppBar
        title="Zeit festlegen"
        onBack={() => router.back()}
        action={{ icon: 'bell', label: 'Meldungen' }}
      />

      <div className="pos-scroll flex min-h-px w-full flex-1 flex-col gap-[16px] px-[16px] pb-[16px] pt-[8px]">
        {/* Полоска заказа: напоминание, о каком заказе речь, без ухода назад. */}
        <PosScreenState state={state} onRetry={refresh} />

        <div className="flex w-full items-center gap-[8px] rounded-[12px] bg-[var(--pos-bg-surface-2)] px-[12px] py-[10px]">
          <span className="pos-label-m text-[var(--pos-text-primary)]">
            {order
              ? `#${order.number} · ${order.deliveryType === 'pickup' ? 'Abholung' : 'Lieferung'}`
              : 'Bestellung'}
          </span>
          <span className="h-px min-w-px flex-1" />
          <span className="pos-label-m pos-num text-[var(--pos-text-secondary)]">
            {order?.total ?? ''}
          </span>
        </div>

        <div className="flex w-full flex-col items-center gap-[12px] rounded-[18px] border border-[var(--pos-border-strong)] bg-[var(--pos-bg-surface)] p-[14px]">
          <span className="pos-overline text-[var(--pos-text-muted)]">FERTIG GEGEN</span>
          <div className="flex w-full items-center gap-[12px]">
            <PosStepButton
              label="−5"
              onClick={() => setMinutes((v) => clamp(v - STEP))}
              disabled={minutes <= MIN_MINUTES}
            />
            <div className="flex min-w-px flex-1 flex-col items-center gap-[2px]">
              <span className="pos-display-m pos-num text-[var(--pos-accent)]">{target}</span>
              <span className="pos-body-s text-[var(--pos-text-secondary)]">
                in {minutes} Minuten
              </span>
            </div>
            <PosStepButton
              label="+5"
              onClick={() => setMinutes((v) => clamp(v + STEP))}
              disabled={minutes >= MAX_MINUTES}
            />
          </div>
        </div>

        <span className="pos-overline text-[var(--pos-text-muted)]">SCHNELLAUSWAHL</span>

        <div className="flex w-full flex-col gap-[10px]">
          <div className="flex w-full gap-[10px]">
            {PRESETS.slice(0, 3).map((preset) => (
              <PosTimeChip
                key={preset}
                label={`${preset} Min`}
                selected={minutes === preset}
                onClick={() => setMinutes(preset)}
              />
            ))}
          </div>
          <div className="flex w-full gap-[10px]">
            {PRESETS.slice(3).map((preset) => (
              <PosTimeChip
                key={preset}
                label={`${preset} Min`}
                selected={minutes === preset}
                onClick={() => setMinutes(preset)}
              />
            ))}
            {/* «Andere» — не пресет: подсвечивается, когда значение задано шагами. */}
            <PosTimeChip
              label="Andere"
              selected={!PRESETS.includes(minutes as (typeof PRESETS)[number])}
            />
          </div>
        </div>

        <p className="pos-body-s w-full text-[var(--pos-text-muted)]">
          Presets aus der Küche: 30 / 45 / 60 / 90 / 120 Min. Feinjustierung mit ±5.
        </p>

        {error && (
          <p className="pos-body-s w-full rounded-[12px] bg-[var(--pos-tint-cancelled)] px-[12px] py-[10px] text-[var(--pos-status-cancelled)]">
            {error}
          </p>
        )}
      </div>

      <PosActionBar>
        <PosButton
          label={`Bestellung annehmen · ${target}`}
          disabled={busy || !orderId}
          onClick={accept}
        />
      </PosActionBar>
    </>
  );
}

/** useSearchParams требует границы ожидания — иначе предрендер страницы падает. */
export default function SetTimePage() {
  return (
    <Suspense fallback={null}>
      <SetTimeScreen />
    </Suspense>
  );
}
