/**
 * Недельный график приёма заказов: по каждому дню — свои интервалы.
 *
 * storeSettings.ordersWeeklySchedule = { mon: [{ start: '10:00', end: '14:00' },
 * { start: '17:00', end: '21:00' }], …, sun: [] } — пустой день = выходной.
 * Конец '00:00' значит «до полуночи». Интервал через полночь (18:00–02:00) не
 * поддерживаем: хвост после 00:00 — отдельный интервал следующего дня.
 *
 * Пока графика нет (старые настройки), действует прежняя пара
 * ordersStartHour/ordersEndHour — одна и та же на все семь дней.
 *
 * Модуль ЧИСТЫЙ: им одинаково судят сервер заказов, чекаут, мобильный
 * bootstrap и витрина — разойдись эти копии, сайт обещал бы одно, а принимал
 * другое.
 */

import {
  formatOrderHoursTemplate,
  getDayOfWeekInTimeZone,
  getNowMinutesInTimeZone,
  resolveOrderAcceptanceHours,
} from './order-acceptance-hours';

export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export interface TimeRange {
  start: string;
  end: string;
}

export type WeeklySchedule = Record<WeekdayKey, TimeRange[]>;

/** Больше двух-трёх смен в день не бывает; потолок — чтобы форма не разрасталась. */
export const MAX_RANGES_PER_DAY = 4;

const DAY_MINUTES = 24 * 60;
const DEFAULT_TIME_ZONE = 'Europe/Berlin';

type ScheduleLocale = 'de' | 'ru';

export const WEEKDAY_LABELS: Record<ScheduleLocale, { short: string[]; long: string[] }> = {
  de: {
    short: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
    long: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'],
  },
  ru: {
    short: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
    long: ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'],
  },
};

function labelsFor(locale: string | undefined) {
  return WEEKDAY_LABELS[locale === 'ru' ? 'ru' : 'de'];
}

/** JS getDay() (0 = Вс … 6 = Сб) → ключ дня графика. */
export function weekdayKeyFromJsDay(jsDay: number): WeekdayKey {
  return WEEKDAY_KEYS[(((jsDay + 6) % 7) + 7) % 7];
}

export function weekdayLabel(day: WeekdayKey, locale?: string, form: 'short' | 'long' = 'long'): string {
  return labelsFor(locale)[form][WEEKDAY_KEYS.indexOf(day)];
}

/** Строгий разбор HH:mm → минуты; мусор → null. */
function parseHHmm(value: unknown): number | null {
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h === 24 && m === 0) return DAY_MINUTES;
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

function toHHmm(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function rangeStartMinutes(range: TimeRange): number {
  return parseHHmm(range.start) ?? 0;
}

/** Конец '00:00' (или '24:00') — полночь, то есть конец суток. */
export function rangeEndMinutes(range: TimeRange): number {
  const end = parseHHmm(range.end) ?? 0;
  return end === 0 ? DAY_MINUTES : end;
}

export function emptyWeeklySchedule(): WeeklySchedule {
  return Object.fromEntries(WEEKDAY_KEYS.map((day) => [day, []])) as unknown as WeeklySchedule;
}

export interface ScheduleError {
  day: WeekdayKey;
  /** Индекс интервала; нет — ошибка про день целиком. */
  index?: number;
  message: string;
}

/**
 * Проверка графика из формы/запроса. Ошибки — по-русски, для админки.
 * schedule — нормализованный (HH:mm с ведущим нулём, интервалы по порядку)
 * только когда ошибок нет.
 */
export function validateWeeklySchedule(raw: unknown): {
  schedule: WeeklySchedule | null;
  errors: ScheduleError[];
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { schedule: null, errors: [{ day: 'mon', message: 'График не заполнен' }] };
  }
  const source = raw as Record<string, unknown>;
  const errors: ScheduleError[] = [];
  const schedule = emptyWeeklySchedule();

  for (const day of WEEKDAY_KEYS) {
    const list = source[day];
    if (list == null) continue;
    if (!Array.isArray(list)) {
      errors.push({ day, message: 'Неверный формат дня' });
      continue;
    }
    if (list.length > MAX_RANGES_PER_DAY) {
      errors.push({ day, message: `Не больше ${MAX_RANGES_PER_DAY} интервалов в день` });
    }

    const parsed: Array<{ start: number; end: number; index: number }> = [];
    list.forEach((item, index) => {
      const start = parseHHmm((item as any)?.start);
      const endRaw = parseHHmm((item as any)?.end);
      if (start == null || endRaw == null || start === DAY_MINUTES) {
        errors.push({ day, index, message: 'Укажите время начала и конца' });
        return;
      }
      const end = endRaw === 0 ? DAY_MINUTES : endRaw;
      if (end <= start) {
        errors.push({
          day,
          index,
          message: 'Конец должен быть позже начала (после полуночи — интервалом следующего дня)',
        });
        return;
      }
      parsed.push({ start, end, index });
    });

    parsed.sort((a, b) => a.start - b.start);
    for (let i = 1; i < parsed.length; i += 1) {
      if (parsed[i].start < parsed[i - 1].end) {
        errors.push({ day, index: parsed[i].index, message: 'Интервалы пересекаются' });
      }
    }

    schedule[day] = parsed.map((r) => ({ start: toHHmm(r.start), end: toHHmm(r.end) }));
  }

  return { schedule: errors.length ? null : schedule, errors };
}

/** График из настроек, если он сохранён и цел; иначе null. */
export function normalizeWeeklySchedule(raw: unknown): WeeklySchedule | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!WEEKDAY_KEYS.some((day) => day in (raw as object))) return null;
  return validateWeeklySchedule(raw).schedule;
}

/** Прежняя модель: одна пара «с/до» на все дни. */
export function legacyScheduleFromSettings(
  settings: { ordersStartHour?: unknown; ordersEndHour?: unknown } | null | undefined
): WeeklySchedule {
  const { start, end } = resolveOrderAcceptanceHours(settings);
  const range = { start, end };
  const valid = rangeEndMinutes(range) > rangeStartMinutes(range);
  return Object.fromEntries(
    WEEKDAY_KEYS.map((day) => [day, valid ? [{ ...range }] : []])
  ) as unknown as WeeklySchedule;
}

/** Действующий график: сохранённый по дням, иначе старая единая пара. */
export function resolveWeeklySchedule(settings: Record<string, any> | null | undefined): WeeklySchedule {
  return normalizeWeeklySchedule(settings?.ordersWeeklySchedule) ?? legacyScheduleFromSettings(settings);
}

/**
 * Самое раннее начало и самый поздний конец недели — пишем в старые поля
 * ordersStartHour/ordersEndHour, чтобы фолбэк не устаревал.
 */
export function scheduleBounds(schedule: WeeklySchedule): { start: string; end: string } | null {
  const ranges = WEEKDAY_KEYS.flatMap((day) => schedule[day]);
  if (!ranges.length) return null;
  const start = Math.min(...ranges.map(rangeStartMinutes));
  const end = Math.max(...ranges.map(rangeEndMinutes));
  return { start: toHHmm(start), end: toHHmm(end) };
}

export function weeklySchedulesEqual(a: WeeklySchedule, b: WeeklySchedule): boolean {
  return WEEKDAY_KEYS.every(
    (day) =>
      a[day].length === b[day].length &&
      a[day].every((r, i) => r.start === b[day][i].start && r.end === b[day][i].end)
  );
}

export interface OrderHoursState {
  open: boolean;
  today: WeekdayKey;
  todayRanges: TimeRange[];
  /** Интервал, который идёт сейчас (open = true). */
  current: TimeRange | null;
  /**
   * Ближайшее открытие, когда сейчас закрыто: позже сегодня (daysAhead = 0 —
   * до первой смены или перерыв) или в другой день. null — открыто сейчас
   * либо в графике нет ни одного рабочего дня.
   */
  nextOpening: { daysAhead: number; day: WeekdayKey; time: string } | null;
}

export function getOrderHoursState(
  schedule: WeeklySchedule,
  timeZone: string | undefined,
  now: Date
): OrderHoursState {
  const tz = timeZone || DEFAULT_TIME_ZONE;
  const nowMinutes = getNowMinutesInTimeZone(tz, now);
  const todayIndex = WEEKDAY_KEYS.indexOf(weekdayKeyFromJsDay(getDayOfWeekInTimeZone(tz, now)));
  const today = WEEKDAY_KEYS[todayIndex];
  const todayRanges = schedule[today];

  const current =
    todayRanges.find((r) => rangeStartMinutes(r) <= nowMinutes && nowMinutes < rangeEndMinutes(r)) ??
    null;
  if (current) {
    return { open: true, today, todayRanges, current, nextOpening: null };
  }

  const laterToday = todayRanges.find((r) => rangeStartMinutes(r) > nowMinutes);
  if (laterToday) {
    return {
      open: false,
      today,
      todayRanges,
      current: null,
      nextOpening: { daysAhead: 0, day: today, time: laterToday.start },
    };
  }

  for (let daysAhead = 1; daysAhead <= 7; daysAhead += 1) {
    const day = WEEKDAY_KEYS[(todayIndex + daysAhead) % 7];
    const first = schedule[day][0];
    if (first) {
      return {
        open: false,
        today,
        todayRanges,
        current: null,
        nextOpening: { daysAhead, day, time: first.start },
      };
    }
  }

  return { open: false, today, todayRanges, current: null, nextOpening: null };
}

/** «morgen» / «Montag» — для {day} в сообщении о закрытии. */
export function formatNextOpeningDay(
  nextOpening: { daysAhead: number; day: WeekdayKey },
  locale?: string
): string {
  if (nextOpening.daysAhead === 0) return locale === 'ru' ? 'сегодня' : 'heute';
  if (nextOpening.daysAhead === 1) return locale === 'ru' ? 'завтра' : 'morgen';
  return weekdayLabel(nextOpening.day, locale);
}

export interface OrderHoursVerdict {
  accepting: boolean;
  /** Текст гостю, когда приём закрыт по графику. */
  message: string | null;
  /** Время ближайшего открытия (HH:mm), если оно есть. */
  opensAtTime: string | null;
  state: OrderHoursState;
}

/**
 * Можно ли сейчас заказать по графику. Тексты — из админки:
 * — «до открытия» (до первой смены дня и в перерыве), {time};
 * — «после закрытия» (смены дня кончились / выходной), {day} и {time}.
 * defaults — тексты на случай пустых настроек: у сервера и чекаута свои.
 */
export function evaluateOrderHours(
  settings: Record<string, any> | null | undefined,
  now: Date,
  defaults: { beforeOpen: string; afterClose: string; locale?: string }
): OrderHoursVerdict {
  const schedule = resolveWeeklySchedule(settings);
  const state = getOrderHoursState(schedule, settings?.ordersTimeZone, now);
  if (state.open) {
    return { accepting: true, message: null, opensAtTime: null, state };
  }

  const next = state.nextOpening;
  if (next && next.daysAhead === 0) {
    const template = settings?.ordersClosedMessageBeforeOpen || defaults.beforeOpen;
    return {
      accepting: false,
      message: template.replace(/\{time\}/g, next.time),
      opensAtTime: next.time,
      state,
    };
  }

  const template: string = settings?.ordersClosedMessageAfterClose || defaults.afterClose;
  const message = next
    ? template
        .replace(/\{day\}/g, formatNextOpeningDay(next, defaults.locale))
        .replace(/\{time\}/g, next.time)
    : template.replace(/\{day\}|\{time\}/g, '').replace(/\s{2,}/g, ' ').trim();
  return { accepting: false, message, opensAtTime: next?.time ?? null, state };
}

/* ---------- Показ ---------- */

export function formatRanges(ranges: TimeRange[], separator = ', '): string {
  return ranges.map((r) => `${r.start}–${r.end}`).join(separator);
}

/**
 * Все семь дней с одним и тем же единственным интервалом — тогда витрина
 * пишет по-старому «täglich 17:00 - 22:00».
 */
export function uniformDailyRange(schedule: WeeklySchedule): TimeRange | null {
  const first = schedule.mon;
  if (first.length !== 1) return null;
  const same = WEEKDAY_KEYS.every(
    (day) =>
      schedule[day].length === 1 &&
      schedule[day][0].start === first[0].start &&
      schedule[day][0].end === first[0].end
  );
  return same ? first[0] : null;
}

/** «Mo–Fr», «Sa, So», «Mo, Mi–So» — подряд идущие дни сворачиваются. */
function formatDayRuns(indexes: number[], locale?: string): string {
  const short = labelsFor(locale).short;
  const runs: number[][] = [];
  for (const index of indexes) {
    const run = runs[runs.length - 1];
    if (run && run[run.length - 1] === index - 1) run.push(index);
    else runs.push([index]);
  }
  return runs
    .map((run) => {
      if (run.length >= 3) return `${short[run[0]]}–${short[run[run.length - 1]]}`;
      return run.map((i) => short[i]).join(', ');
    })
    .join(', ');
}

/**
 * Неделя строками для витрины: дни с одинаковыми часами склеены.
 * ['Mo–Fr 10:00–14:00, 17:00–21:00', 'Sa, So 17:00–22:00', 'Di Ruhetag'].
 */
export function formatScheduleLines(
  schedule: WeeklySchedule,
  options: { locale?: string; closedLabel: string }
): string[] {
  const groups = new Map<string, number[]>();
  WEEKDAY_KEYS.forEach((day, index) => {
    const key = formatRanges(schedule[day]);
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  return Array.from(groups.entries())
    .sort((a, b) => a[1][0] - b[1][0])
    .map(([ranges, indexes]) => `${formatDayRuns(indexes, options.locale)} ${ranges || options.closedLabel}`);
}

type Translate = (key: string, fallback: string) => string;

/**
 * Часы в верхней полосе хедера. Все дни одинаковые — прежний шаблон
 * «täglich {start} - {end}»; иначе — только сегодняшние смены.
 */
export function headerHoursText(
  schedule: WeeklySchedule,
  options: { t: Translate; timeZone?: string; now: Date; uniformTemplate?: string }
): string {
  const uniform = uniformDailyRange(schedule);
  if (uniform) {
    return formatOrderHoursTemplate(
      options.uniformTemplate ?? options.t('header.hours', 'täglich {start} - {end}'),
      uniform
    );
  }
  const { todayRanges } = getOrderHoursState(schedule, options.timeZone, options.now);
  return todayRanges.length
    ? options.t('header.hours_today', 'heute {hours}').replace('{hours}', formatRanges(todayRanges))
    : options.t('header.closed_today', 'heute Ruhetag');
}

/** Неделя строками для футера/главной; Ruhetag — из переводов. */
export function weeklyHoursLines(
  schedule: WeeklySchedule,
  options: { t: Translate; locale?: string }
): string[] {
  return formatScheduleLines(schedule, {
    locale: options.locale,
    closedLabel: options.t('header.closed_label', 'Ruhetag'),
  });
}

const SCHEMA_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** schema.org openingHoursSpecification: по записи на каждую пару «открытие/закрытие». */
export function toOpeningHoursSpecification(schedule: WeeklySchedule) {
  const byRange = new Map<string, { opens: string; closes: string; days: string[] }>();
  WEEKDAY_KEYS.forEach((day, index) => {
    for (const range of schedule[day]) {
      // Google понимает полночь закрытия как 23:59 — «00:00» читается как начало суток.
      const closes = rangeEndMinutes(range) === DAY_MINUTES ? '23:59' : range.end;
      const key = `${range.start}-${closes}`;
      const entry = byRange.get(key) ?? { opens: range.start, closes, days: [] };
      entry.days.push(SCHEMA_DAYS[index]);
      byRange.set(key, entry);
    }
  });
  return Array.from(byRange.values()).map((entry) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: entry.days,
    opens: entry.opens,
    closes: entry.closes,
  }));
}
