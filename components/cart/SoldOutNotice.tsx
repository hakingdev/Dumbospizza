"use client";

import {
  SOLD_OUT_LABELS,
  soldOutLineTitle,
  type SoldOutLine,
  type SoldOutReason,
} from '../../lib/menu-stop/sold-out';
import { NoTranslate } from '../NoTranslate';

type Translate = (key: string, fallback?: string) => string;
const passthrough: Translate = (_key, fallback) => fallback ?? _key;

const LABEL_KEYS: Record<SoldOutReason, string> = {
  product: 'cart.sold_out_today',
  size: 'cart.size_unavailable_today',
};

/** Подпись причины: «Heute ausverkauft» / «Größe heute nicht verfügbar». */
export function soldOutReasonLabel(reason: SoldOutReason, t: Translate = passthrough): string {
  return t(LABEL_KEYS[reason], SOLD_OUT_LABELS[reason]);
}

/**
 * Строка корзины, которую сервер отклонит: товар сняли с продажи или выключили
 * выбранный размер (стоп-бот/админка/POS) уже после добавления в корзину.
 * Помечаем строку и даём убрать её одним нажатием.
 */
export function SoldOutItemNote({
  reason,
  onRemove,
  t = passthrough,
}: {
  reason: SoldOutReason;
  onRemove: () => void;
  t?: Translate;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-red-700">
        🚫 {soldOutReasonLabel(reason, t)}
      </p>
      <button
        type="button"
        onClick={onRemove}
        className="min-h-[32px] text-sm font-medium text-red-900 underline underline-offset-2 hover:text-red-700"
      >
        {t('cart.remove', 'Entfernen')}
      </button>
    </div>
  );
}

/** Сводка над кнопкой оформления: перечень строк + «убрать все». */
export function SoldOutSummary({
  lines,
  onRemoveAll,
  t = passthrough,
  className = '',
}: {
  lines: readonly SoldOutLine[];
  onRemoveAll?: () => void;
  t?: Translate;
  className?: string;
}) {
  if (lines.length === 0) return null;
  return (
    <div
      className={`rounded-lg border border-red-200 bg-red-50 p-3 ${className}`}
      role="alert"
      data-testid="sold-out-summary"
    >
      <div className="flex items-start gap-3">
        <span className="text-xl leading-none" aria-hidden="true">
          🚫
        </span>
        <div className="min-w-0 flex-1 text-sm leading-6 text-red-900">
          <p className="font-semibold">{t('cart.sold_out_summary_title', 'Nicht mehr verfügbar:')}</p>
          <ul className="mt-1 space-y-0.5">
            {lines.map((line) => (
              <li key={line.item.id} className="break-words">
                <NoTranslate>{soldOutLineTitle(line.item)}</NoTranslate>
                <span className="text-red-700"> — {soldOutReasonLabel(line.reason, t)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2">
            {t('cart.sold_out_hint', 'Bitte entfernen Sie die nicht verfügbaren Artikel, um fortzufahren.')}
          </p>
        </div>
      </div>
      {onRemoveAll && (
        <button
          type="button"
          onClick={onRemoveAll}
          className="mt-3 inline-flex min-h-[40px] w-full items-center justify-center rounded-md bg-red-600 px-3 py-2 text-center text-sm font-medium leading-tight text-white transition-colors hover:bg-red-700"
        >
          {t('cart.remove_unavailable', 'Nicht verfügbare Artikel entfernen')}
        </button>
      )}
    </div>
  );
}
