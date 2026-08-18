'use client';

import type { ReactNode } from 'react';
import { PosIcon } from './primitives';
import {
  EMPTY_WORKSHOP_BLOCKS,
  WORKSHOPS,
  buildWorkshopBlockMessage,
  formatBlockTemplate,
  type WorkshopId,
} from '../../lib/kitchen/workshops';
// formatBerlinTime цеха не реэкспортируют — берём из модуля сообщений о блокировке.
import { formatBerlinTime } from '../../lib/kitchen/block-message';

/**
 * Секция E — стоп кухни (Figma: 12 · Küche stoppen 32:958, 13 · Küchen-Status
 * 33:884, 14 · Betrieb pausiert 22:865).
 *
 * Экран НЕ заводит своего понятия «пауза». Он управляет теми же двумя записями
 * в storeSettings, что и стоп-бот в Telegram и админка: `ordersBlockedUntil`
 * (весь приём) и `workshopsBlockedUntil` (цех). Поэтому и набор областей здесь
 * тот же самый, что `ControlScope` в lib/telegram-control.ts — прибор просто
 * ещё одна кнопка к общему выключателю, а не второй выключатель рядом.
 *
 * Сам telegram-control сюда не импортируется: он ходит в базу, а это клиентский
 * компонент. Общее — чистый lib/kitchen/workshops.ts.
 */

export type PosStopScope = 'all' | WorkshopId;

/**
 * Порядок на выборе «что стоппим»: «Alles» последним. Самое разрушительное
 * действие не должно стоять под большим пальцем первым.
 */
export const POS_SCOPES_CHOOSE: readonly PosStopScope[] = ['pizza', 'sushi', 'all'];

/** Порядок в «Küchen-Status»: заведение целиком первым — это шапка панели. */
export const POS_SCOPES_STATUS: readonly PosStopScope[] = ['all', 'pizza', 'sushi'];

export const POS_SCOPE_META: Record<
  PosStopScope,
  {
    title: string;
    sub: string;
    /** Иконка в «Küchen-Status»: обозначает предмет — цех или само заведение. */
    icon: string;
    /** Иконка на выборе «что стоппим»: у «Alles» там знак запрета, а не купол. */
    chooseIcon: string;
  }
> = {
  // Названия берём из WORKSHOPS: их же видит гость в сообщении о стопе и
  // персонал в Telegram. Своя копия строк однажды разошлась бы с ними.
  pizza: {
    title: WORKSHOPS.pizza.de,
    sub: 'Pizza, Calzone, Beilagen, Crispy Sides',
    icon: 'scope-pizza',
    chooseIcon: 'scope-pizza',
  },
  sushi: {
    title: WORKSHOPS.sushi.de,
    sub: 'Alle Sushi-Artikel',
    icon: 'scope-sushi',
    chooseIcon: 'scope-sushi',
  },
  all: {
    title: 'Alles',
    sub: 'Kompletter Bestellstopp im Lokal',
    icon: 'dome',
    chooseIcon: 'scope-all',
  },
};

/**
 * Текст глобального стопа по умолчанию — ровно тот, что показывает checkout,
 * когда в настройках пусто. Настоящий берётся из `ordersBlockedReason` в
 * админке и подставится, когда экран подключат к API.
 */
const GLOBAL_BLOCK_FALLBACK =
  'Die Küche ist gerade ausgelastet. Bitte versuchen Sie es später.';

/**
 * Что прочитает гость, если нажать «стоп» прямо сейчас.
 *
 * Собирается ТЕМИ ЖЕ функциями, которыми сайт строит настоящее сообщение, —
 * иначе панель «SO SIEHT ES DER GAST» показывала бы вымысел, и первое же
 * расхождение обнаружил бы гость, а не повар.
 */
export function posGuestBlockText(
  scope: PosStopScope,
  minutes: number,
  now: Date = new Date()
): string {
  const until = new Date(now.getTime() + minutes * 60_000).toISOString();
  if (scope === 'all') return formatBlockTemplate(GLOBAL_BLOCK_FALLBACK, until, now);
  return buildWorkshopBlockMessage([scope], {
    blocks: { ...EMPTY_WORKSHOP_BLOCKS, [scope]: until },
    now,
  });
}

/**
 * Приписка под сообщением гостю. У цехового стопа напитки и десерты остаются
 * доступны (их никто не готовит), у глобального — нет: `ordersBlockedUntil`
 * закрывает оформление заказа целиком.
 */
export function posGuestBlockNote(scope: PosStopScope): string {
  return scope === 'all'
    ? 'Auch Getränke und Desserts sind währenddessen nicht bestellbar.'
    : 'Getränke und Desserts bleiben immer bestellbar.';
}

/** Во сколько снимется стоп: «19:47». */
export function posReleaseTime(minutes: number, now: Date): string {
  return formatBerlinTime(new Date(now.getTime() + minutes * 60_000).toISOString());
}

/** Кнопка внутри карточки — 48 dp. Крупные 56 dp остаются у панели действий. */
function PosScopeButton({
  label,
  tone = 'ghost',
  onClick,
}: {
  label: string;
  tone?: 'ghost' | 'success' | 'danger-outline';
  onClick?: () => void;
}) {
  const skin = {
    ghost:
      'border border-[var(--pos-border-strong)] bg-[var(--pos-bg-surface-2)] text-[var(--pos-text-primary)]',
    success: 'bg-[var(--pos-success)] text-[var(--pos-text-on-accent)]',
    'danger-outline':
      'border border-[var(--pos-status-cancelled)] text-[var(--pos-status-cancelled)]',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pos-label-m flex h-[48px] min-w-px flex-1 items-center justify-center rounded-[12px] px-[10px] ${skin}`}
    >
      {label}
    </button>
  );
}

/** Плашка «Läuft» / «Gestoppt · noch 24 Min». */
function PosScopeState({ minutesLeft }: { minutesLeft: number }) {
  const stopped = minutesLeft > 0;
  return (
    <span
      className="pos-label-s flex shrink-0 items-center gap-[6px] rounded-full px-[10px] py-[5px]"
      style={{
        background: stopped ? 'var(--pos-tint-cancelled)' : 'var(--pos-tint-delivered)',
        color: stopped ? 'var(--pos-status-cancelled)' : 'var(--pos-status-delivered)',
      }}
    >
      <span className="size-[8px] shrink-0 rounded-full bg-current" aria-hidden="true" />
      {stopped ? `Gestoppt · noch ${minutesLeft} Min` : 'Läuft'}
    </span>
  );
}

/** Строка выбора области на экране 12. */
export function PosScopeOption({
  scope,
  selected,
  onSelect,
}: {
  scope: PosStopScope;
  selected: boolean;
  onSelect?: () => void;
}) {
  const meta = POS_SCOPE_META[scope];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      // Рамка всегда 2 px: в макете у выбранного она толще, но если менять
      // толщину, строка на 2 px подпрыгивает под пальцем при каждом выборе.
      className={`flex w-full items-center gap-[12px] rounded-[14px] border-2 py-[10px] pl-[12px] pr-[14px] text-left ${
        selected
          ? 'border-[var(--pos-accent)] bg-[var(--pos-accent-subtle)]'
          : 'border-[var(--pos-border)] bg-[var(--pos-bg-surface)]'
      }`}
    >
      <span
        className={`flex size-[24px] shrink-0 items-center justify-center rounded-full border-2 ${
          selected ? 'border-[var(--pos-accent)]' : 'border-[var(--pos-border-strong)]'
        }`}
      >
        {selected && <span className="size-[9px] rounded-full bg-[var(--pos-accent)]" />}
      </span>
      <span className="flex size-[40px] shrink-0 items-center justify-center rounded-[12px] bg-[var(--pos-bg-surface-2)] text-[var(--pos-accent)]">
        <PosIcon name={meta.chooseIcon} />
      </span>
      <span className="flex min-w-px flex-1 flex-col gap-[2px]">
        <span className="pos-title-s w-full text-[var(--pos-text-primary)]">{meta.title}</span>
        <span className="pos-body-s w-full text-[var(--pos-text-muted)]">{meta.sub}</span>
      </span>
    </button>
  );
}

/**
 * Карточка области в «Küchen-Status» (13). Стоп и снятие живут на одной
 * карточке: искать «где это выключается» человек будет там же, где увидел,
 * что оно включено.
 */
export function PosScopeCard({
  scope,
  minutesLeft = 0,
  onStop,
  onExtend,
  onRelease,
}: {
  scope: PosStopScope;
  /** Сколько минут до автоснятия. 0 — область работает. */
  minutesLeft?: number;
  onStop?: (minutes: 30 | 60) => void;
  onExtend?: () => void;
  onRelease?: () => void;
}) {
  const meta = POS_SCOPE_META[scope];
  const stopped = minutesLeft > 0;
  return (
    <div
      className={`flex w-full flex-col gap-[10px] rounded-[16px] bg-[var(--pos-bg-surface)] px-[14px] py-[12px] ${
        stopped
          ? 'border-2 border-[var(--pos-status-cancelled)]'
          : 'border border-[var(--pos-border)]'
      }`}
    >
      <div className="flex w-full items-center gap-[12px]">
        <span className="flex size-[40px] shrink-0 items-center justify-center rounded-[12px] bg-[var(--pos-bg-surface-2)] text-[var(--pos-accent)]">
          <PosIcon name={meta.icon} />
        </span>
        <span className="flex min-w-px flex-1 flex-col gap-[2px]">
          <span className="pos-title-s w-full text-[var(--pos-text-primary)]">{meta.title}</span>
          <span className="pos-body-s w-full text-[var(--pos-text-muted)]">{meta.sub}</span>
        </span>
      </div>

      <PosScopeState minutesLeft={minutesLeft} />

      <div className="flex w-full gap-[10px]">
        {stopped ? (
          <>
            <PosScopeButton label="+30 Min" onClick={onExtend} />
            <PosScopeButton label="Freigeben" tone="success" onClick={onRelease} />
          </>
        ) : (
          <>
            <PosScopeButton label="30 Min stoppen" onClick={() => onStop?.(30)} />
            <PosScopeButton label="60 Min stoppen" onClick={() => onStop?.(60)} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Баннер активной паузы над лентой заказов (14).
 *
 * Стоит именно на ленте, а не отдельным экраном: пауза — фон, на котором идёт
 * работа. Принятые заказы доготавливаются, и человек должен видеть и их, и
 * причину, по которой новых не появляется.
 */
export function PosPauseBanner({
  scope,
  untilLabel,
  reason,
  countdown,
  onExtend,
  onRelease,
}: {
  scope: PosStopScope;
  /** «19:17» — во сколько приём откроется сам. */
  untilLabel: string;
  reason: string;
  /** «24:16» — сколько осталось. */
  countdown: ReactNode;
  onExtend?: () => void;
  onRelease?: () => void;
}) {
  const title = scope === 'all' ? 'Alles gestoppt' : `${POS_SCOPE_META[scope].title} gestoppt`;
  return (
    <div className="flex w-full shrink-0 flex-col gap-[10px] border-b-2 border-[var(--pos-status-cancelled)] bg-[var(--pos-tint-cancelled)] px-[16px] py-[12px]">
      <div className="flex w-full items-center gap-[10px]">
        <PosIcon
          name="pause"
          size={22}
          className="text-[var(--pos-status-cancelled)]"
        />
        <span className="flex min-w-px flex-1 flex-col gap-px">
          <span className="pos-title-s w-full text-[var(--pos-status-cancelled)]">{title}</span>
          <span className="pos-body-s w-full text-[var(--pos-text-secondary)]">
            Wieder offen um {untilLabel} · {reason}
          </span>
        </span>
        <span className="pos-number-m pos-num shrink-0 text-[var(--pos-status-cancelled)]">
          {countdown}
        </span>
      </div>
      <div className="flex w-full gap-[10px]">
        <PosScopeButton label="+30 Min" tone="danger-outline" onClick={onExtend} />
        <PosScopeButton label="Jetzt freigeben" tone="success" onClick={onRelease} />
      </div>
    </div>
  );
}
