'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
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
import {
  POS_ETA_INITIAL,
  POS_ETA_MAX_MINUTES,
  POS_ETA_MIN_MINUTES,
  POS_ETA_PRESETS,
  POS_ETA_STEP,
  posDesiredChoice,
  posEtaView,
  posShiftEta,
  type PosEtaChoice,
} from '../../../../../lib/pos/eta-choice';

/**
 * 02 · Zeit festlegen (Figma 10:18).
 *
 * Второй шаг приёма: сколько времени кухня просит на заказ. Ответ уезжает гостю,
 * поэтому промах ценой в полчаса дороже лишнего касания — отсюда и крупный
 * стрелочный шаг ±5, и пресеты, и подтверждение с временем прямо на кнопке.
 *
 * Заказ НА ВРЕМЯ открывается сразу на желаемом часе, и ±5 двигает именно его
 * (арифметика — в lib/pos/eta-choice.ts). Раньше экран всегда предлагал «через
 * 30 минут»: заказ, который гость просил на 20:30, принимали на 19:10, и
 * обещание уходило гостю до того, как кто-нибудь замечал Wunschzeit на чеке.
 *
 * Подтверждение делает ровно одно обращение — PUT /api/orders/[id] со статусом
 * и `etaMinutes`. Раньше поставить ПЕРВОЕ обещание было нечем: существовал
 * только POST .../delay, который сдвигает уже назначенное.
 */

function SetTimeScreen() {
  const router = useRouter();
  const search = useSearchParams();
  const orderId = search.get('id');
  const { state, refresh, skewRef } = usePosOrder(orderId);
  // Часы тикают минутно: в виде «к 20:30» от них зависит не только подпись, но
  // и число минут, которое уедет на сервер.
  const nowMs = usePosNow(skewRef, 15_000);

  const [choice, setChoice] = useState<PosEtaChoice>(POS_ETA_INITIAL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const order = state.status === 'ready' ? state.data : null;
  const desiredMs = order?.desiredMs ?? null;

  /**
   * Wunschzeit подставляется ОДИН раз на заказ: экран перечитывается каждые пять
   * секунд, и без этой отметки опрос затирал бы правку кухни через ±5.
   */
  const filledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!order || nowMs == null || filledFor.current === order.id) return;
    const desired = posDesiredChoice(order.desiredMs, nowMs);
    filledFor.current = order.id;
    if (desired) setChoice(desired);
  }, [order, nowMs]);

  const { minutes, targetMs, clamped } = posEtaView(choice, nowMs);
  const target = posClock(targetMs);
  const atDesired = choice.mode === 'at' && desiredMs != null && choice.ms === desiredMs;

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

        {/* Заказ на время. Стоит НАД выбором: это условие задачи, а не подсказка. */}
        {desiredMs != null && (
          <div className="flex w-full items-center gap-[8px] rounded-[12px] bg-[var(--pos-tint-preparing)] px-[12px] py-[10px]">
            <span className="pos-label-m text-[var(--pos-status-preparing)]">
              Bestellung auf Zeit
            </span>
            <span className="h-px min-w-px flex-1" />
            <span className="pos-label-m pos-num text-[var(--pos-status-preparing)]">
              Wunschzeit {posClock(desiredMs)}
            </span>
          </div>
        )}

        <div className="flex w-full flex-col items-center gap-[12px] rounded-[18px] border border-[var(--pos-border-strong)] bg-[var(--pos-bg-surface)] p-[14px]">
          <span className="pos-overline text-[var(--pos-text-muted)]">FERTIG GEGEN</span>
          <div className="flex w-full items-center gap-[12px]">
            <PosStepButton
              label="−5"
              onClick={() => setChoice((prev) => posShiftEta(prev, -POS_ETA_STEP, nowMs))}
              disabled={minutes <= POS_ETA_MIN_MINUTES}
            />
            <div className="flex min-w-px flex-1 flex-col items-center gap-[2px]">
              <span className="pos-display-m pos-num text-[var(--pos-accent)]">{target}</span>
              <span className="pos-body-s text-[var(--pos-text-secondary)]">
                {/* У заказа на время подпись короче: «in 88 Minuten» с пометкой
                    Wunschzeit не влезает в 360 dp и роняет карточку на две строки. */}
                {atDesired ? `Wunschzeit · ${minutes} Min` : `in ${minutes} Minuten`}
              </span>
            </div>
            <PosStepButton
              label="+5"
              onClick={() => setChoice((prev) => posShiftEta(prev, POS_ETA_STEP, nowMs))}
              disabled={minutes >= POS_ETA_MAX_MINUTES}
            />
          </div>
        </div>

        <span className="pos-overline text-[var(--pos-text-muted)]">SCHNELLAUSWAHL</span>

        <div className="flex w-full flex-col gap-[10px]">
          <div className="flex w-full gap-[10px]">
            {POS_ETA_PRESETS.slice(0, 3).map((preset) => (
              <PosTimeChip
                key={preset}
                label={`${preset} Min`}
                selected={choice.mode === 'in' && choice.minutes === preset}
                onClick={() => setChoice({ mode: 'in', minutes: preset })}
              />
            ))}
          </div>
          <div className="flex w-full gap-[10px]">
            {POS_ETA_PRESETS.slice(3).map((preset) => (
              <PosTimeChip
                key={preset}
                label={`${preset} Min`}
                selected={choice.mode === 'in' && choice.minutes === preset}
                onClick={() => setChoice({ mode: 'in', minutes: preset })}
              />
            ))}
            {/* У заказа на время последняя фишка — возврат к желаемому часу
                после правок ±5. Без неё вернуться к нему нечем. */}
            {desiredMs != null ? (
              <PosTimeChip
                label={posClock(desiredMs)}
                selected={atDesired}
                onClick={() => setChoice({ mode: 'at', ms: desiredMs })}
              />
            ) : (
              /* «Andere» — не пресет: подсвечивается, когда значение задано шагами. */
              <PosTimeChip
                label="Andere"
                selected={
                  choice.mode === 'at' ||
                  !POS_ETA_PRESETS.includes(choice.minutes as (typeof POS_ETA_PRESETS)[number])
                }
              />
            )}
          </div>
        </div>

        <p className="pos-body-s w-full text-[var(--pos-text-muted)]">
          {desiredMs != null
            ? `Gast wünscht ${posClock(desiredMs)}. Mit ±5 von dieser Zeit verschieben, Presets rechnen ab jetzt.`
            : 'Presets aus der Küche: 30 / 45 / 60 / 90 / 120 Min. Feinjustierung mit ±5.'}
        </p>

        {clamped && (
          <p className="pos-body-s w-full rounded-[12px] bg-[var(--pos-tint-preparing)] px-[12px] py-[10px] text-[var(--pos-status-preparing)]">
            Weiter als {POS_ETA_MAX_MINUTES} Minuten voraus kann nicht zugesagt werden —
            Bestellung später annehmen oder {target} bestätigen.
          </p>
        )}

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
