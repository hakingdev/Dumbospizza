"use client";

import { availabilityBadge, scheduleClosedCartMessage, type CategoryWindow } from '../../lib/categories/availability';

/**
 * Позиция корзины вне времени продажи своей категории (бургер положили в 21:50,
 * оформляют в 22:05): помечаем строку и даём убрать её одним нажатием.
 */
export function ScheduleClosedItemNote({ window, onRemove }: { window: CategoryWindow; onRemove: () => void }) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
        🕒 Nicht mehr verfügbar · {availabilityBadge(window)}
      </p>
      <button
        type="button"
        onClick={onRemove}
        className="min-h-[32px] text-sm font-medium text-amber-900 underline underline-offset-2 hover:text-amber-700"
      >
        Entfernen
      </button>
    </div>
  );
}

/** Сводка над кнопкой оформления. */
export function ScheduleClosedSummary({ windows, className = '' }: { windows: CategoryWindow[]; className?: string }) {
  if (windows.length === 0) return null;
  return (
    <div className={`flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 ${className}`}>
      <span className="text-xl leading-none" aria-hidden="true">
        🕒
      </span>
      <p className="text-sm leading-6 text-amber-900">{scheduleClosedCartMessage(windows)}</p>
    </div>
  );
}
