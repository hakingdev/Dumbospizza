'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  PosActionBar,
  PosAppBar,
  PosButton,
  PosStatusBar,
  PosStepButton,
  PosTimeChip,
} from '../../../../components/pos/primitives';
import {
  POS_SCOPES_CHOOSE,
  PosScopeOption,
  posGuestBlockNote,
  posGuestBlockText,
  posReleaseTime,
  type PosStopScope,
} from '../../../../components/pos/kitchen';
import { posClock, posSetStop, usePosNow } from '../../../../components/pos/data';

/**
 * 12 · Küche stoppen (Werkstatt-Stopp), Figma 32:958.
 *
 * Экран отвечает на два вопроса — что стоппим и насколько — и сразу показывает
 * последствия: во сколько снимется само и что в это время прочитает гость.
 * Текст гостя не переписан от руки, а собран теми же функциями, что и на сайте
 * (см. posGuestBlockText): иначе панель обещала бы одно, а гость видел другое.
 */

/** Быстрые длительности из макета. Третья кнопка открывает шаг ±5. */
const QUICK = [30, 60] as const;

const MIN_MINUTES = 5;
const MAX_MINUTES = 180;

export default function KitchenStopPage() {
  const router = useRouter();
  const nowMs = usePosNow(undefined, 30_000);
  const now = nowMs == null ? null : new Date(nowMs);

  const [scope, setScope] = useState<PosStopScope>('pizza');
  const [minutes, setMinutes] = useState(30);
  /** «Andere» — не значение, а режим: длительность набирается шагом ±5. */
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = (delta: number) =>
    setMinutes((m) => Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, m + delta)));

  /**
   * Стоп ставится и уходит на панель состояния. Возврата «назад» здесь нет
   * намеренно: человек должен увидеть, что именно встало и до какого времени,
   * а не вернуться на экран, с которого пришёл.
   */
  const applyStop = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await posSetStop(scope, minutes);
    setBusy(false);
    if (result.ok) router.push('/pos/kitchen');
    else setError(result.unauthorized ? 'Nicht angemeldet' : result.error || 'Fehlgeschlagen');
  };

  return (
    <>
      <PosStatusBar time={posClock(nowMs)} />
      <PosAppBar
        title="Küche stoppen"
        onBack={() => router.back()}
        action={{ icon: 'bell', label: 'Meldungen' }}
      />

      <div className="pos-scroll flex min-h-px w-full flex-1 flex-col gap-[10px] px-[16px] pb-[14px] pt-[8px]">
        <span className="pos-overline text-[var(--pos-text-muted)]">WAS STOPPEN?</span>

        <div role="radiogroup" className="flex w-full flex-col gap-[10px]">
          {POS_SCOPES_CHOOSE.map((id) => (
            <PosScopeOption
              key={id}
              scope={id}
              selected={scope === id}
              onSelect={() => setScope(id)}
            />
          ))}
        </div>

        <span className="pos-overline pt-[4px] text-[var(--pos-text-muted)]">WIE LANGE?</span>

        <div className="flex w-full gap-[10px]">
          {QUICK.map((m) => (
            <PosTimeChip
              key={m}
              label={`${m} Min`}
              selected={!custom && minutes === m}
              onClick={() => {
                setCustom(false);
                setMinutes(m);
              }}
            />
          ))}
          <PosTimeChip label="Andere" selected={custom} onClick={() => setCustom(true)} />
        </div>

        {custom && (
          <div className="flex w-full items-center gap-[12px]">
            <PosStepButton label="−5" onClick={() => step(-5)} disabled={minutes <= MIN_MINUTES} />
            <span className="pos-display-m pos-num min-w-px flex-1 text-center text-[var(--pos-text-primary)]">
              {minutes}
            </span>
            <PosStepButton label="+5" onClick={() => step(5)} disabled={minutes >= MAX_MINUTES} />
          </div>
        )}

        <div className="flex w-full flex-col items-center gap-[2px] rounded-[14px] border border-[var(--pos-border-strong)] bg-[var(--pos-bg-surface)] py-[10px]">
          <span className="pos-title-m pos-num text-[var(--pos-text-primary)]">
            {/* До монтирования часов нет — иначе серверное время разошлось бы
                с приборным. Пустая строка держит высоту карточки. */}
            {now ? `Wieder ab ${posReleaseTime(minutes, now)} Uhr` : ' '}
          </span>
          <span className="pos-body-s text-[var(--pos-text-muted)]">
            Freigabe passiert automatisch
          </span>
        </div>

        <div className="flex w-full flex-col gap-[6px] rounded-[14px] bg-[var(--pos-tint-preparing)] px-[12px] py-[10px]">
          <span className="pos-overline text-[var(--pos-status-preparing)]">
            SO SIEHT ES DER GAST
          </span>
          <span className="pos-body-s w-full text-[var(--pos-text-secondary)]">
            {now ? `„${posGuestBlockText(scope, minutes, now)}“` : ' '}
          </span>
          <span className="pos-label-s w-full text-[var(--pos-status-preparing)]">
            {posGuestBlockNote(scope)}
          </span>
        </div>

        {error && (
          <p className="pos-body-s w-full rounded-[12px] bg-[var(--pos-tint-cancelled)] px-[12px] py-[10px] text-[var(--pos-status-cancelled)]">
            {error}
          </p>
        )}
      </div>

      <PosActionBar>
        <PosButton label="Abbrechen" variant="ghost" onClick={() => router.back()} />
        <PosButton
          label={`${minutes} Min stoppen`}
          variant="danger"
          disabled={busy}
          onClick={applyStop}
        />
      </PosActionBar>
    </>
  );
}
