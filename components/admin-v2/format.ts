/** Форматирование сумм/дат портала — немецкая локаль, как на чеках. */

const euroFmt = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
});

export function euro(value: number | string | null | undefined): string {
  const num = Number(value) || 0;
  return euroFmt.format(num);
}

const euroWholeFmt = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

/** «1.310 €» без центов — для узких мест (подписи баров на мобилке). */
export function euroWhole(value: number | string | null | undefined): string {
  const num = Number(value) || 0;
  return euroWholeFmt.format(num);
}

const RU_WEEKDAYS = [
  'Воскресенье',
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
];

/** «Понедельник, 10. August 2026» — как в дизайне: день недели по-русски, дата по-немецки. */
export function ruWeekdayDeDate(date: Date): string {
  const dePart = new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
  return `${RU_WEEKDAYS[date.getDay()]}, ${dePart}`;
}

export function timeHHmm(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function dateDDMMYYYY(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

/** Инициалы для аватара: «Maxim Kern» → «MK». */
export function initials(name: string | null | undefined): string {
  if (!name) return 'DP';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || '').join('') || 'DP';
}
