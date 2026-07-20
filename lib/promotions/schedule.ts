import {
  getNowMinutesInTimeZone,
  getDayOfWeekInTimeZone,
  parseOrdersTimeToMinutes,
  formatMinutesAsHHmm,
} from '../order-acceptance-hours';

// Живёт в order-acceptance-hours рядом с getNowMinutesInTimeZone: день недели
// нужен не только акциям (баннеры главной берут его оттуда же, минуя движок акций).
export { getDayOfWeekInTimeZone };

export interface HappyHourScheduleFields {
  weekdayScheduleEnabled?: boolean;
  happyHourEnabled?: boolean;
  activeDaysOfWeek?: number[];
  activeTimeStart?: string;
  activeTimeEnd?: string;
  scheduleTimeZone?: string;
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DAY_NAMES_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** Lieferando-Modus: акция только в выбранные дни недели. */
export function isOnScheduledWeekday(
  promo: HappyHourScheduleFields,
  now: Date = new Date()
): boolean {
  if (!promo.weekdayScheduleEnabled) return true;
  const days = promo.activeDaysOfWeek?.length ? promo.activeDaysOfWeek : ALL_DAYS;
  const timeZone = promo.scheduleTimeZone || 'Europe/Berlin';
  return days.includes(getDayOfWeekInTimeZone(timeZone, now));
}

export function formatWeekdayScheduleLabel(promo: HappyHourScheduleFields): string | undefined {
  if (!promo.weekdayScheduleEnabled) return undefined;
  const days = [...(promo.activeDaysOfWeek?.length ? promo.activeDaysOfWeek : ALL_DAYS)].sort(
    (a, b) => a - b
  );
  if (days.length === 7) return 'Täglich';
  if (days.length === 0) return undefined;
  return days.map((d) => DAY_NAMES_DE[d]).join(', ');
}

/** Только часовое окно (без дней недели — они в isOnScheduledWeekday). */
export function isWithinHappyHourTimeWindow(
  promo: HappyHourScheduleFields,
  now: Date = new Date()
): boolean {
  if (!promo.happyHourEnabled) return true;

  const timeZone = promo.scheduleTimeZone || 'Europe/Berlin';
  const start = parseOrdersTimeToMinutes(promo.activeTimeStart, 0);
  const end = parseOrdersTimeToMinutes(promo.activeTimeEnd, 23 * 60 + 59);
  const nowMinutes = getNowMinutesInTimeZone(timeZone, now);

  if (start <= end) {
    return nowMinutes >= start && nowMinutes < end;
  }
  return nowMinutes >= start || nowMinutes < end;
}

/** @deprecated use isWithinHappyHourTimeWindow — kept for callers expecting old name */
export function isWithinHappyHourSchedule(
  promo: HappyHourScheduleFields,
  now: Date = new Date()
): boolean {
  return isWithinHappyHourTimeWindow(promo, now);
}

export function formatHappyHourLabel(promo: HappyHourScheduleFields): string | undefined {
  if (!promo.happyHourEnabled) return undefined;
  const start = formatMinutesAsHHmm(parseOrdersTimeToMinutes(promo.activeTimeStart, 16));
  const end = formatMinutesAsHHmm(parseOrdersTimeToMinutes(promo.activeTimeEnd, 18));
  return `${start}–${end} Uhr`;
}

export function minutesSinceHappyHourStart(
  promo: HappyHourScheduleFields,
  now: Date = new Date()
): number | null {
  if (!promo.happyHourEnabled) return null;
  if (!isOnScheduledWeekday(promo, now)) return null;
  if (!isWithinHappyHourTimeWindow(promo, now)) return null;

  const timeZone = promo.scheduleTimeZone || 'Europe/Berlin';
  const start = parseOrdersTimeToMinutes(promo.activeTimeStart, 16);
  const nowMinutes = getNowMinutesInTimeZone(timeZone, now);
  let since = nowMinutes - start;
  if (since < 0) since += 24 * 60;
  return since;
}
