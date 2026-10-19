'use client';

/**
 * Редактор недельного графика приёма заказов: по каждому дню — тумблер
 * «работаем / выходной» и до MAX_RANGES_PER_DAY интервалов (утро + вечер).
 * Используется в портале (/admin-v2/venue) и в старой /admin/settings.
 */

import { useRef } from 'react';
import {
  MAX_RANGES_PER_DAY,
  WEEKDAY_KEYS,
  rangeEndMinutes,
  type ScheduleError,
  type TimeRange,
  type WeekdayKey,
  type WeeklySchedule,
  weekdayLabel,
} from '../../lib/opening-schedule';
import { Toggle, btnGhost, btnSoft } from './ui';

const DEFAULT_RANGE: TimeRange = { start: '17:00', end: '22:00' };

const timeInput =
  'h-11 min-w-0 flex-1 rounded-xl border bg-white px-3 text-base leading-6 text-gray-900 outline-none transition tabular-nums focus:border-[#8A6C4C]';

function minutesToHHmm(minutes: number): string {
  const clamped = Math.min(minutes, 24 * 60);
  const h = Math.floor(clamped / 60) % 24;
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Новый интервал — через час после последнего, на 4 часа (не дальше полуночи). */
function nextRangeAfter(ranges: TimeRange[]): TimeRange | null {
  const last = ranges[ranges.length - 1];
  if (!last) return { ...DEFAULT_RANGE };
  const lastEnd = rangeEndMinutes(last);
  if (lastEnd >= 23 * 60) return null;
  const start = lastEnd + 60;
  return { start: minutesToHHmm(start), end: minutesToHHmm(Math.min(start + 4 * 60, 24 * 60)) };
}

export function WeeklyScheduleEditor({
  value,
  onChange,
  errors,
  today,
}: {
  value: WeeklySchedule;
  onChange: (next: WeeklySchedule) => void;
  errors: ScheduleError[];
  /** Подсветить сегодняшний день. */
  today?: WeekdayKey;
}) {
  /* Выключили день и включили обратно — возвращаем его прежние интервалы. */
  const remembered = useRef<Partial<Record<WeekdayKey, TimeRange[]>>>({});

  const setDay = (day: WeekdayKey, ranges: TimeRange[]) => onChange({ ...value, [day]: ranges });

  const toggleDay = (day: WeekdayKey, open: boolean) => {
    if (!open) {
      remembered.current[day] = value[day];
      setDay(day, []);
      return;
    }
    const restore =
      remembered.current[day] ??
      WEEKDAY_KEYS.map((d) => value[d]).find((ranges) => ranges.length > 0) ?? [DEFAULT_RANGE];
    setDay(
      day,
      restore.map((r) => ({ ...r }))
    );
  };

  const updateRange = (day: WeekdayKey, index: number, patch: Partial<TimeRange>) =>
    setDay(
      day,
      value[day].map((r, i) => (i === index ? { ...r, ...patch } : r))
    );

  const copyToAll = (day: WeekdayKey) => {
    const source = value[day];
    const label = weekdayLabel(day, 'ru').toLowerCase();
    if (!confirm(`Поставить часы «${label}» на все дни недели?`)) return;
    onChange(
      Object.fromEntries(
        WEEKDAY_KEYS.map((d) => [d, source.map((r) => ({ ...r }))])
      ) as unknown as WeeklySchedule
    );
  };

  return (
    <div className="flex flex-col">
      {WEEKDAY_KEYS.map((day) => {
        const ranges = value[day];
        const open = ranges.length > 0;
        const dayErrors = errors.filter((e) => e.day === day && e.index === undefined);
        const canAdd = open && ranges.length < MAX_RANGES_PER_DAY && nextRangeAfter(ranges) !== null;
        return (
          <div key={day} className="flex flex-col gap-2 border-t border-gray-200 py-3 first:border-t-0 first:pt-0">
            <div className="flex items-center gap-2">
              <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-base font-bold leading-6 text-gray-900">
                {weekdayLabel(day, 'ru')}
                {today === day && (
                  <span className="text-xs font-bold uppercase tracking-[.04em] text-[#8A6C4C]">
                    сегодня
                  </span>
                )}
              </span>
              {open && (
                <button
                  type="button"
                  onClick={() => copyToAll(day)}
                  className={`${btnGhost} h-8 flex-none px-2 text-sm leading-5 text-[#7C6145]`}
                  title="Скопировать часы этого дня на всю неделю"
                >
                  На все дни
                </button>
              )}
              <Toggle
                on={open}
                label={open ? `${weekdayLabel(day, 'ru')}: сделать выходным` : `${weekdayLabel(day, 'ru')}: рабочий день`}
                onChange={(next) => toggleDay(day, next)}
              />
            </div>

            {!open && (
              <span className="text-sm leading-5 text-gray-600">Выходной — заказы не принимаем</span>
            )}

            {ranges.map((range, index) => {
              const rangeErrors = errors.filter((e) => e.day === day && e.index === index);
              const invalid = rangeErrors.length > 0;
              return (
                <div key={index} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      aria-label={`${weekdayLabel(day, 'ru')}, интервал ${index + 1}: начало`}
                      value={range.start}
                      onChange={(e) => updateRange(day, index, { start: e.target.value })}
                      className={`${timeInput} ${invalid ? 'border-[#D42A47]' : 'border-gray-300'}`}
                    />
                    <span className="flex-none text-gray-500">–</span>
                    <input
                      type="time"
                      aria-label={`${weekdayLabel(day, 'ru')}, интервал ${index + 1}: конец`}
                      value={range.end}
                      onChange={(e) => updateRange(day, index, { end: e.target.value })}
                      className={`${timeInput} ${invalid ? 'border-[#D42A47]' : 'border-gray-300'}`}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setDay(
                          day,
                          ranges.filter((_, i) => i !== index)
                        )
                      }
                      aria-label="Удалить интервал"
                      title="Удалить интервал"
                      className={`${btnGhost} h-11 w-11 flex-none text-xl leading-none text-gray-500`}
                    >
                      ×
                    </button>
                  </div>
                  {rangeErrors.map((e) => (
                    <span key={e.message} className="text-sm leading-5 text-[#D42A47]">
                      {e.message}
                    </span>
                  ))}
                </div>
              );
            })}

            {dayErrors.map((e) => (
              <span key={e.message} className="text-sm leading-5 text-[#D42A47]">
                {e.message}
              </span>
            ))}

            {canAdd && (
              <button
                type="button"
                onClick={() => {
                  const next = nextRangeAfter(ranges);
                  if (next) setDay(day, [...ranges, next]);
                }}
                className={`${btnSoft} h-9 self-start px-3 text-sm leading-5`}
              >
                + Добавить интервал
              </button>
            )}
          </div>
        );
      })}
      <p className="m-0 border-t border-gray-200 pt-3 text-sm leading-5 text-gray-600">
        Конец 00:00 — до полуночи. Интервал после полуночи добавьте следующему дню.
      </p>
    </div>
  );
}
