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
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

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
  // Неделя в Германии начинается с понедельника: «Mo–Fr», «Täglich außer Mi»
  // вместо «So, Mo, Di, Do, Fr, Sa» (а модалка дописывала к этому «Jeden»).
  const active = new Set(days);
  if (active.size === 6) {
    const off = MONDAY_FIRST.find((d) => !active.has(d)) as number;
    return `Täglich außer ${DAY_NAMES_DE[off]}`;
  }
  const runs: number[][] = [];
  for (const d of MONDAY_FIRST) {
    if (!active.has(d)) continue;
    const last = runs[runs.length - 1];
    const prev = last ? last[last.length - 1] : undefined;
    if (last && prev !== undefined && MONDAY_FIRST.indexOf(d) === MONDAY_FIRST.indexOf(prev) + 1) last.push(d);
    else runs.push([d]);
  }
  return runs
    .map((run) =>
      run.length >= 3
        ? `${DAY_NAMES_DE[run[0]]}–${DAY_NAMES_DE[run[run.length - 1]]}`
        : run.map((d) => DAY_NAMES_DE[d]).join(', ')
    )
    .join(', ');
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
