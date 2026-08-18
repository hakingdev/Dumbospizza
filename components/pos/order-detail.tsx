'use client';

import { POS_STATUS, PosStatusBadge, type PosOrderStatus } from './order-list';
import { useState } from 'react';
import {
  PosButton,
  PosIcon,
  PosSheet,
  PosStepButton,
  PosTimeChip,
} from './primitives';

/**
 * Блоки экрана деталей заказа (Figma: Status & Zeit 12:444, Order Progress 47:64,
 * Küchenbon 41:900, Zeit verlängern 12:458).
 */

/**
 * Шаги заказа. По описанию компонента в Figma: у самовывоза последний шаг
 * называется «Abgeholt», а отменённые заказы прогресс не показывают вовсе —
 * им некуда двигаться.
 */
export function PosOrderProgress({
  step,
  pickup = false,
}: {
  step: 1 | 2 | 3 | 4;
  pickup?: boolean;
}) {
  const steps = ['Angenommen', 'Zubereitung', 'Fertig', pickup ? 'Abgeholt' : 'Geliefert'];
  return (
    <div className="flex h-[32px] w-full items-start gap-[4px]">
      {steps.map((label, i) => {
        const done = i < step;
        // Ближайший будущий шаг подсвечен сильнее дальних: видно, что произойдёт
        // следующим, а что ещё далеко.
        const bar = done
          ? 'bg-[var(--pos-accent)]'
          : i === step
            ? 'bg-[var(--pos-border-strong)]'
            : 'bg-[var(--pos-border)]';
        const text = done ? 'text-[var(--pos-text-secondary)]' : 'text-[var(--pos-text-muted)]';
        return (
          <div key={label} className="flex min-w-px flex-1 flex-col gap-[6px]">
            <span className={`h-[4px] w-full rounded-[2px] ${bar}`} />
            <span className={`pos-label-2xs w-full ${text}`}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function PosStatusTimeCard({
  status,
  asideLabel,
  bigValue,
  subTop,
  subBottom,
  progressPercent,
  step,
  pickup,
}: {
  status: PosOrderStatus;
  asideLabel: string;
  bigValue: string;
  subTop: string;
  subBottom: string;
  /** Полоса обратного отсчёта. Не показывается там, где отсчёт потерял смысл. */
  progressPercent?: number;
  step?: 1 | 2 | 3 | 4;
  pickup?: boolean;
}) {
  const tone = POS_STATUS[status].text;
  return (
    <div className="flex w-full flex-col gap-[12px] rounded-[16px] border border-[var(--pos-border)] bg-[var(--pos-bg-surface)] p-[14px]">
      <div className="flex w-full items-center gap-[8px]">
        <PosStatusBadge status={status} />
        <span className="h-px min-w-px flex-1" />
        <span className="pos-body-s shrink-0 text-[var(--pos-text-muted)]">{asideLabel}</span>
      </div>

      <div className="flex w-full items-center gap-[10px]">
        <span className="pos-display-m pos-num shrink-0" style={{ color: tone }}>
          {bigValue}
        </span>
        <div className="flex min-w-px flex-1 flex-col gap-px">
          <span className="pos-body-s text-[var(--pos-text-secondary)]">{subTop}</span>
          <span className="pos-label-m text-[var(--pos-text-primary)]">{subBottom}</span>
        </div>
      </div>

      {progressPercent !== undefined && (
        <div className="h-[8px] w-full overflow-hidden rounded-full bg-[var(--pos-bg-surface-2)]">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, Math.max(0, progressPercent))}%`,
              background: tone,
            }}
          />
        </div>
      )}

      {step && <PosOrderProgress step={step} pickup={pickup} />}
    </div>
  );
}

/**
 * Состояние кухонного бона.
 *
 * `pending` отделён от `queued` НЕ ради красоты. Заказ лежит в `pending` сколько
 * угодно: пока автопечать выключена или пока агент до него не дошёл. Раньше оба
 * случая назывались «в очереди» и кнопка в них была заблокирована — то есть на
 * заказе, который никто не собирался печатать, кнопка печати не нажималась
 * вовсе, и со стороны кухни это выглядело как «ничего не происходит».
 * Блокировать имеет смысл только `queued` — когда задание правда в работе.
 */
export type PosPrintState = 'printed' | 'pending' | 'queued' | 'failed';

const PRINT_STATE: Record<
  PosPrintState,
  { label: string; color: string; tint: string; action: string; busy: boolean }
> = {
  printed: {
    label: 'Gedruckt',
    color: 'var(--pos-status-delivered)',
    tint: 'var(--pos-tint-delivered)',
    action: 'Erneut drucken',
    busy: false,
  },
  pending: {
    label: 'Noch nicht gedruckt',
    color: 'var(--pos-text-muted)',
    tint: 'var(--pos-bg-surface-2)',
    action: 'Jetzt drucken',
    busy: false,
  },
  queued: {
    label: 'Wird gedruckt',
    color: 'var(--pos-status-preparing)',
    tint: 'var(--pos-tint-preparing)',
    // Пока задание правда в работе, кнопка заблокирована: второе нажатие
    // добавило бы второй чек, а не ускорило первый.
    action: 'Wird gedruckt …',
    busy: true,
  },
  failed: {
    label: 'Fehler',
    color: 'var(--pos-status-cancelled)',
    tint: 'var(--pos-tint-cancelled)',
    action: 'Erneut versuchen',
    busy: false,
  },
};

/**
 * Кухонный бон: состояние печати и повтор.
 *
 * Витрина существующей очереди печати: чек печатает боннер у кассы, а прибор
 * лишь показывает, что стало с заданием, и умеет попросить повтор.
 */
export function PosKitchenReceiptCard({
  state,
  lineOne,
  lineTwo,
  onPrint,
}: {
  state: PosPrintState;
  lineOne: string;
  lineTwo: string;
  onPrint?: () => void;
}) {
  const s = PRINT_STATE[state];
  return (
    <div className="flex w-full flex-col gap-[10px] rounded-[16px] border border-[var(--pos-border)] bg-[var(--pos-bg-surface)] p-[14px]">
      <div className="flex w-full items-center gap-[8px]">
        <span className="pos-overline text-[var(--pos-text-muted)]">KÜCHENBON</span>
        <span className="h-px min-w-px flex-1" />
        <span
          className="pos-label-s flex shrink-0 items-center gap-[6px] rounded-full px-[10px] py-[5px]"
          style={{ background: s.tint, color: s.color }}
        >
          <span className="size-[8px] rounded-full bg-current" aria-hidden="true" />
          {s.label}
        </span>
      </div>

      <div className="flex w-full flex-col gap-[2px]">
        <span className="pos-body-m text-[var(--pos-text-secondary)]">{lineOne}</span>
        <span className="pos-body-s text-[var(--pos-text-muted)]">{lineTwo}</span>
      </div>

      <button
        type="button"
        onClick={onPrint}
        disabled={s.busy}
        className="pos-label-m flex h-[48px] w-full items-center justify-center gap-[8px] rounded-[12px] border border-[var(--pos-border-strong)] bg-[var(--pos-bg-surface-2)] px-[14px] text-[var(--pos-text-primary)] disabled:opacity-60"
      >
        <PosIcon name="printer" size={20} />
        {s.action}
      </button>

      {state === 'failed' && (
        <p className="pos-body-s w-full rounded-[12px] bg-[var(--pos-tint-cancelled)] p-[12px] text-[var(--pos-text-secondary)]">
          Papierrolle und Kassen-PC prüfen. Der Auftrag bleibt in der Warteschlange und wird
          automatisch wiederholt.
        </p>
      )}
    </div>
  );
}

/** Продление времени: три быстрых шага плюс произвольная длительность. */
export function PosExtendTimeCard({
  onExtend,
  onOther,
}: {
  onExtend?: (minutes: number) => void;
  onOther?: () => void;
}) {
  return (
    <div className="flex w-full flex-col gap-[12px] rounded-[16px] border border-[var(--pos-border)] bg-[var(--pos-bg-surface)] p-[14px]">
      <span className="pos-overline text-[var(--pos-text-muted)]">ZEIT VERLÄNGERN</span>
      <div className="flex w-full gap-[10px]">
        {[10, 15, 20].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onExtend?.(m)}
            className="pos-label-l flex h-[52px] min-w-px flex-1 items-center justify-center rounded-[12px] border border-[var(--pos-border)] bg-[var(--pos-bg-surface-2)] text-[var(--pos-text-primary)]"
          >
            +{m} Min
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onOther}
        className="pos-body-s text-left text-[var(--pos-text-muted)] underline"
      >
        Andere Dauer (5–60 Min, Schritt 5)
      </button>
    </div>
  );
}

/** Карточка гостя. Телефон — ссылка: на приборе это набор одним касанием. */
export function PosCustomerCard({
  name,
  address,
  phone,
}: {
  name: string;
  address: string;
  phone: string;
}) {
  return (
    <div className="flex w-full flex-col gap-[4px] rounded-[16px] border border-[var(--pos-border)] bg-[var(--pos-bg-surface)] p-[14px]">
      <span className="pos-title-s text-[var(--pos-text-primary)]">{name}</span>
      <span className="pos-body-m text-[var(--pos-text-secondary)]">{address}</span>
      <a
        href={`tel:${phone.replace(/\s/g, '')}`}
        className="pos-label-m pos-num text-[var(--pos-status-delivering)]"
      >
        {phone} · anrufen
      </a>
    </div>
  );
}

export interface PosDetailItem {
  qty: number;
  name: string;
  price: string;
}

/** Состав заказа с примечанием и итогом. */
export function PosItemsCard({
  items,
  note,
  totalLabel,
  total,
}: {
  items: PosDetailItem[];
  note?: string;
  totalLabel: string;
  total: string;
}) {
  return (
    <div className="flex w-full flex-col gap-[10px] rounded-[16px] border border-[var(--pos-border)] bg-[var(--pos-bg-surface)] p-[14px]">
      {items.map((item) => (
        <div key={item.name} className="flex w-full items-start gap-[8px]">
          <span className="pos-label-l pos-num shrink-0 text-[var(--pos-accent)]">{item.qty}×</span>
          <span className="pos-body-m min-w-px flex-1 text-[var(--pos-text-primary)]">
            {item.name}
          </span>
          <span className="pos-label-m pos-num shrink-0 text-[var(--pos-text-secondary)]">
            {item.price}
          </span>
        </div>
      ))}
      <span className="h-px w-full bg-[var(--pos-border)]" />
      {note && <span className="pos-body-s w-full text-[var(--pos-text-muted)]">{note}</span>}
      <div className="flex w-full items-center gap-[8px]">
        <span className="pos-body-m shrink-0 text-[var(--pos-text-secondary)]">{totalLabel}</span>
        <span className="h-px min-w-px flex-1" />
        <span className="pos-number-m pos-num shrink-0 text-[var(--pos-text-primary)]">
          {total}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Шторки экрана деталей: 08 · Zeit verlängern (13:444) и 15 · Küchenbon (42:892)
// ---------------------------------------------------------------------------

/** «19:25» + 15 → «19:40». Через полночь крутится по кругу. */
export function addMinutesToClock(clock: string, minutes: number): string {
  const [h, m] = clock.split(':').map((v) => parseInt(v, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return clock;
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** Быстрые прибавки из макета. Третья в нижнем ряду — режим шага ±5. */
const EXTEND_QUICK = [10, 15, 20, 30, 45] as const;

const EXTEND_MIN = 5;
const EXTEND_MAX = 60;

/**
 * 08 · Zeit verlängern.
 *
 * Крупно показано НЕ «+15», а новое время готовности: гостю уходит именно оно,
 * и сверять оператор будет его. Прибавка идёт второй строкой.
 */
export function PosExtendSheet({
  open,
  finishAt,
  onClose,
  onConfirm,
}: {
  open: boolean;
  /** Обещанное сейчас время готовности, «19:25». */
  finishAt: string;
  onClose?: () => void;
  onConfirm?: (minutes: number) => void;
}) {
  const [minutes, setMinutes] = useState(15);
  /** «Andere» — режим набора шагом ±5, а не отдельное значение. */
  const [custom, setCustom] = useState(false);

  const step = (delta: number) =>
    setMinutes((m) => Math.min(EXTEND_MAX, Math.max(EXTEND_MIN, m + delta)));

  return (
    <PosSheet
      open={open}
      align="center"
      title="Zeit verlängern"
      subtitle={`Bisher fertig um ${finishAt} Uhr`}
      onClose={onClose}
      actions={
        <>
          <PosButton label="Abbrechen" variant="ghost" onClick={onClose} />
          <PosButton label="Verlängern" onClick={() => onConfirm?.(minutes)} />
        </>
      }
    >
      <div className="flex w-full flex-col items-center gap-[2px] rounded-[16px] bg-[var(--pos-accent-subtle)] py-[12px]">
        <span className="pos-display-m pos-num text-[var(--pos-accent)]">
          {addMinutesToClock(finishAt, minutes)} Uhr
        </span>
        <span className="pos-label-m text-[var(--pos-text-secondary)]">+{minutes} Minuten</span>
      </div>

      <div className="flex w-full flex-col gap-[10px]">
        <div className="flex w-full gap-[10px]">
          {EXTEND_QUICK.slice(0, 3).map((m) => (
            <PosTimeChip
              key={m}
              label={`+${m} Min`}
              selected={!custom && minutes === m}
              onClick={() => {
                setCustom(false);
                setMinutes(m);
              }}
            />
          ))}
        </div>
        <div className="flex w-full gap-[10px]">
          {EXTEND_QUICK.slice(3).map((m) => (
            <PosTimeChip
              key={m}
              label={`+${m} Min`}
              selected={!custom && minutes === m}
              onClick={() => {
                setCustom(false);
                setMinutes(m);
              }}
            />
          ))}
          <PosTimeChip label="Andere" selected={custom} onClick={() => setCustom(true)} />
        </div>
      </div>

      {custom && (
        <div className="flex w-full items-center gap-[12px]">
          <PosStepButton label="−5" onClick={() => step(-5)} disabled={minutes <= EXTEND_MIN} />
          <span className="pos-title-l pos-num min-w-px flex-1 text-center text-[var(--pos-text-primary)]">
            +{minutes} Min
          </span>
          <PosStepButton label="+5" onClick={() => step(5)} disabled={minutes >= EXTEND_MAX} />
        </div>
      )}

      {/* В макете написано «SMS», но заказ шлёт гостю WhatsApp через Twilio
          (POST /api/orders/[id]/delay). Пишем то, что придёт на самом деле. */}
      <p className="pos-body-s w-full text-center text-[var(--pos-text-muted)]">
        Erlaubt sind {EXTEND_MIN}–{EXTEND_MAX} Min. Kunde bekommt automatisch eine
        WhatsApp-Nachricht.
      </p>
    </PosSheet>
  );
}

/**
 * 15 · Küchenbon erneut drucken.
 *
 * Показывает не «печатаю», а «встаёт в очередь под номером N»: чек выходит из
 * боннера у кассы, обратной связи от него нет. Предпросмотр собран той же
 * раскладкой, что уйдёт в принтер, — из renderOpsToText на ширину прибора.
 */
export function PosPrintSheet({
  open,
  lines,
  lastPrintedAt,
  printSeq,
  onClose,
  onConfirm,
}: {
  open: boolean;
  /** Готовые строки чека — ровно то, что напечатается. */
  lines: string[];
  lastPrintedAt: string;
  /** Номер последнего задания печати; новое встанет следующим. */
  printSeq: number;
  onClose?: () => void;
  onConfirm?: () => void;
}) {
  return (
    <PosSheet
      open={open}
      title="Küchenbon erneut drucken"
      onClose={onClose}
      actions={
        <>
          <PosButton label="Abbrechen" variant="ghost" onClick={onClose} />
          <PosButton label="Bon drucken" onClick={onConfirm} />
        </>
      }
    >
      <p className="pos-body-s w-full text-[var(--pos-text-secondary)]">
        Geht als neuer Druckauftrag an den Bondrucker an der Kasse. Der Druck startet in ca. 5
        Sekunden.
      </p>

      <div className="flex w-full items-center gap-[8px] rounded-[12px] bg-[var(--pos-bg-surface-2)] px-[12px] py-[10px]">
        <span className="pos-body-m text-[var(--pos-text-secondary)]">
          Zuletzt gedruckt {lastPrintedAt}
        </span>
        <span className="h-px min-w-px flex-1" />
        <span className="pos-label-m pos-num shrink-0 text-[var(--pos-text-primary)]">
          Druck Nr. {printSeq}
        </span>
      </div>

      {/* Ширина чека фиксированная, а экран уже — поэтому предпросмотр
          прокручивается вбок сам, а не переносит строки: перенос показал бы
          раскладку, которой не будет на бумаге. */}
      <div className="w-full overflow-x-auto rounded-[10px] border border-[var(--pos-border)] bg-[var(--pos-bg-surface)] px-[12px] py-[14px]">
        <pre className="pos-mono text-[var(--pos-text-secondary)]">{lines.join('\n')}</pre>
      </div>

      <p className="pos-label-s w-full text-center text-[var(--pos-text-muted)]">
        Wird als Druck Nr. {printSeq + 1} eingereiht · Bon-Inhalt unverändert
      </p>
    </PosSheet>
  );
}
