/**
 * Видимость рекламного баннера на главной.
 *
 * Показ задаётся днями недели, а не окном дат: «2+1 по понедельникам» —
 * повторяющийся оффер, окно дат пришлось бы продлевать вручную каждую неделю.
 *
 * Фильтрация в JS, а не в SQL: баннеров единицы, а «день недели в Europe/Berlin»
 * compat-слой (lib/db/mongoose-compat.ts) в условие всё равно не выражает.
 */

import { getDayOfWeekInTimeZone } from '../order-acceptance-hours';

export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export const DEFAULT_BANNER_TIME_ZONE = 'Europe/Berlin';

/** Порядок недели по-европейски: Пн первый, Вс последний. */
export const WEEKDAY_OPTIONS = [
  { value: 1, labelDe: 'Mo', labelRu: 'Пн' },
  { value: 2, labelDe: 'Di', labelRu: 'Вт' },
  { value: 3, labelDe: 'Mi', labelRu: 'Ср' },
  { value: 4, labelDe: 'Do', labelRu: 'Чт' },
  { value: 5, labelDe: 'Fr', labelRu: 'Пт' },
  { value: 6, labelDe: 'Sa', labelRu: 'Сб' },
  { value: 0, labelDe: 'So', labelRu: 'Вс' },
];

export interface BannerVisibilityFields {
  enabled?: boolean;
  activeDaysOfWeek?: unknown;
  scheduleTimeZone?: string | null;
}

/**
 * Приводит любое значение из БД или формы к списку дней 0–6: только целые в
 * диапазоне, без дублей, отсортированы. Мусор отбрасывается поштучно, а не
 * целиком — один кривой элемент не должен обнулять остальные дни.
 */
export function normalizeActiveDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const days = value
    // Отсев до Number(): Number(null) и Number('') дают 0, то есть случайный
    // null в JSON молча включил бы воскресенье.
    .filter((d) => typeof d === 'number' || (typeof d === 'string' && d.trim() !== ''))
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  // indexOf, а не Set: target es5 не разворачивает Set без downlevelIteration,
  // а дней максимум семь — стоимость O(n²) здесь не считается.
  return days.filter((d, i) => days.indexOf(d) === i).sort((a, b) => a - b);
}

/**
 * Дни для показа. Пустой или нечитаемый список = «каждый день»: баннер лучше
 * покажем лишний раз, чем молча спрячем из-за кривого значения в БД.
 * Ту же трактовку использует движок акций (lib/promotions/schedule.ts).
 */
export function resolveActiveDays(value: unknown): number[] {
  const days = normalizeActiveDays(value);
  return days.length ? days : ALL_WEEKDAYS;
}

/** Баннер виден, если включён и сегодняшний день недели входит в расписание. */
export function isBannerVisible(banner: BannerVisibilityFields, now: Date = new Date()): boolean {
  if (banner.enabled === false) return false;

  const days = resolveActiveDays(banner.activeDaysOfWeek);
  if (days.length === 7) return true;

  const timeZone = banner.scheduleTimeZone || DEFAULT_BANNER_TIME_ZONE;
  return days.includes(getDayOfWeekInTimeZone(timeZone, now));
}

/** Подпись расписания для админки: «Пн, Вт» либо «Каждый день». */
export function formatWeekdayLabel(value: unknown, locale: 'de' | 'ru' = 'ru'): string {
  const days = resolveActiveDays(value);
  if (days.length === 7) return locale === 'de' ? 'Täglich' : 'Каждый день';

  return WEEKDAY_OPTIONS.filter((o) => days.includes(o.value))
    .map((o) => (locale === 'de' ? o.labelDe : o.labelRu))
    .join(', ');
}
