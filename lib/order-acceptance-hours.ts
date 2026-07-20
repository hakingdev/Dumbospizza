/**
 * Настройки «приём заказов с / до» в storeSettings:
 * — число 17 → 17:00 (обратная совместимость)
 * — строка "21:30" или "21"
 */

export function normalizeStoredOrdersTime(value: unknown, defaultHour: number): string {
  const def = `${String(Math.min(23, Math.max(0, defaultHour))).padStart(2, '0')}:00`;
  if (value == null || value === '') return def;

  if (typeof value === 'number' && !Number.isNaN(value)) {
    const h = Math.min(23, Math.max(0, Math.floor(value)));
    return `${String(h).padStart(2, '0')}:00`;
  }

  const s = String(value).trim();
  const hm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    const h = parseInt(hm[1], 10);
    const min = parseInt(hm[2], 10);
    if (h >= 0 && h < 24 && min >= 0 && min < 60) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }

  if (/^\d{1,2}$/.test(s)) {
    const h = parseInt(s, 10);
    if (h >= 0 && h < 24) return `${String(h).padStart(2, '0')}:00`;
  }

  const n = Number(s);
  if (!Number.isNaN(n) && n >= 0 && n < 24) {
    return `${String(Math.floor(n)).padStart(2, '0')}:00`;
  }

  return def;
}

/** Дефолты для витрины — совпадают с прежним статическим текстом «17:00 - 21:30». */
export const DEFAULT_ORDERS_START_HHMM = '17:00';
export const DEFAULT_ORDERS_END_HHMM = '21:30';

function normalizeOrDefault(value: unknown, defaultHHmm: string): string {
  if (value == null || value === '') return defaultHHmm;
  return normalizeStoredOrdersTime(value, parseInt(defaultHHmm, 10));
}

/** «Приём заказов с/до» из storeSettings для показа на витрине (хедер/футер/главная). */
export function resolveOrderAcceptanceHours(
  settings: { ordersStartHour?: unknown; ordersEndHour?: unknown } | null | undefined
): { start: string; end: string } {
  return {
    start: normalizeOrDefault(settings?.ordersStartHour, DEFAULT_ORDERS_START_HHMM),
    end: normalizeOrDefault(settings?.ordersEndHour, DEFAULT_ORDERS_END_HHMM),
  };
}

/**
 * Подставляет {start}/{end} в строку перевода.
 * Одинарные скобки — чтобы i18next не трогал плейсхолдеры (его синтаксис {{...}}).
 */
export function formatOrderHoursTemplate(template: string, hours: { start: string; end: string }): string {
  return template.replace(/\{start\}/g, hours.start).replace(/\{end\}/g, hours.end);
}

export function parseOrdersTimeToMinutes(value: unknown, defaultHour: number): number {
  const hhmm = normalizeStoredOrdersTime(value, defaultHour);
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  return h * 60 + m;
}

export function formatMinutesAsHHmm(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function getNowMinutesInTimeZone(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/**
 * День недели (0 = Вс … 6 = Сб) в заданной зоне, а не в зоне сервера.
 * На Vercel сервер живёт в UTC: в 00:30 по Берлину там ещё вчера, и
 * расписание «только понедельник» отработало бы воскресеньем.
 */
export function getDayOfWeekInTimeZone(timeZone: string, date: Date): number {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[weekday] ?? date.getDay();
}
