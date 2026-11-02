"use client";

import { WeeklyScheduleEditor } from '../admin-v2/weekly-schedule-editor';
import {
  WEEKDAY_KEYS,
  formatScheduleLines,
  validateWeeklySchedule,
  type WeeklySchedule,
} from '../../lib/opening-schedule';

/** Новый график — сразу пример из жизни: каждый день 17:00–22:00, дальше правят под себя. */
function defaultSchedule(): WeeklySchedule {
  return Object.fromEntries(
    WEEKDAY_KEYS.map((day) => [day, [{ start: '17:00', end: '22:00' }]])
  ) as unknown as WeeklySchedule;
}

/** «Пн–Пт 17:00–22:00 · Сб, Вс не продаём» — для списка категорий. */
export function formatAvailabilitySummary(schedule: WeeklySchedule): string {
  return formatScheduleLines(schedule, { locale: 'ru', closedLabel: 'не продаём' }).join(' · ');
}

/**
 * Время продажи категории или подкатегории (lib/categories/availability).
 * Выключено — продаём всё время работы ресторана; включено — только в
 * отмеченные дни и часы (бургеры 17–22). Окно не расширяет часы ресторана.
 */
export default function AvailabilityScheduleField({
  value,
  onChange,
  title = 'Продаётся только в определённое время',
}: {
  value: WeeklySchedule | null | undefined;
  onChange: (next: WeeklySchedule | null) => void;
  title?: string;
}) {
  const errors = value ? validateWeeklySchedule(value).errors : [];
  return (
    <div>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked ? defaultSchedule() : null)}
        />
        <span className="text-sm font-medium">{title}</span>
      </label>
      <p className="mt-1 text-xs text-gray-500">
        Вне этих часов товары видны на сайте серыми с плашкой «Erhältlich ab …», заказать их нельзя.
        Часы работы ресторана график не расширяет.
      </p>
      {value && (
        <div className="mt-3 rounded-lg border p-4">
          <WeeklyScheduleEditor
            value={value}
            onChange={onChange}
            errors={errors}
            closedDayLabel="Не продаём в этот день"
          />
        </div>
      )}
    </div>
  );
}
