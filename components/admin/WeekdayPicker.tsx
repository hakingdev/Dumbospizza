"use client";

import { CalendarDays } from 'lucide-react';
import {
  ALL_WEEKDAYS,
  WEEKDAY_OPTIONS,
  formatWeekdayLabel,
} from '../../lib/banners/visibility';

/** Расписание показа по дням недели — «2+1 по понедельникам» без правок каждую неделю. */
export function WeekdayPicker({
  value,
  onChange,
}: {
  value: number[];
  onChange: (days: number[]) => void;
}) {
  const isEveryDay = value.length === 7;

  const toggle = (day: number) => {
    const next = value.includes(day) ? value.filter((d) => d !== day) : [...value, day];
    onChange(next.sort((a, b) => a - b));
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 text-sm text-gray-600">
        <CalendarDays className="h-4 w-4 text-gray-400" />
        Дни показа
        {!isEveryDay && (
          <button
            type="button"
            onClick={() => onChange([...ALL_WEEKDAYS])}
            className="text-xs text-primary-600 underline hover:text-primary-700"
          >
            каждый день
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Дни показа баннера">
        {WEEKDAY_OPTIONS.map((day) => {
          const active = value.includes(day.value);
          return (
            <button
              key={day.value}
              type="button"
              onClick={() => toggle(day.value)}
              aria-pressed={active}
              className={`w-11 rounded-lg border px-2 py-1.5 text-sm transition ${
                active
                  ? 'border-primary-600 bg-primary-600 font-medium text-white'
                  : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
              }`}
            >
              {day.labelRu}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-gray-400">
        {value.length === 0
          ? 'Ничего не выбрано — баннер будет показываться каждый день'
          : isEveryDay
            ? 'Показывается каждый день'
            : `Только ${formatWeekdayLabel(value)} — остальные дни баннер скрыт`}
      </p>
    </div>
  );
}
