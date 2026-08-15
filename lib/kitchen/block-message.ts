/**
 * Подстановки в текстах о паузе приёма — одни и те же для двух настроек:
 *   - `ordersBlockedReason`     — весь приём стоит («Сообщение при перегрузке кухни»);
 *   - `workshopsBlockedMessage` — стоит цех (пицца / MakiLove).
 *
 * Плейсхолдеры:
 *   {minutes} или @ — сколько ещё ждать, СРАЗУ СО СЛОВОМ: «20 Minuten», «1 Minute»;
 *   {time}          — во сколько снова примем, HH:mm по Берлину.
 *
 * «Minuten» после плейсхолдера съедается: и «in {minutes}», и привычное
 * «in {minutes} Minuten» дадут «in 20 Minuten», а не «20 Minuten Minuten».
 * Файл чистый (без БД) — им пользуются и сервер, и клиент.
 */

const BERLIN_TZ = 'Europe/Berlin';

/** true — метка блокировки ещё не истекла. */
export function isBlockActive(until: unknown, now: Date = new Date()): boolean {
  if (typeof until !== 'string' || !until) return false;
  const time = new Date(until).getTime();
  return Number.isFinite(time) && time > now.getTime();
}

/** Сколько минут осталось до конца стопа (вверх; 0 — стоп уже не активен). */
export function remainingBlockMinutes(until: unknown, now: Date = new Date()): number {
  if (!isBlockActive(until, now)) return 0;
  const diffMs = new Date(until as string).getTime() - now.getTime();
  return Math.max(1, Math.ceil(diffMs / 60_000));
}

/**
 * Позднейшая из двух меток. Нужна там, где стоп цеха и глобальный стоп активны
 * одновременно: обещать «через 10 минут», когда цех стоит 30, нельзя.
 */
export function laterUntil(a: unknown, b: unknown): string {
  const at = typeof a === 'string' && a ? new Date(a).getTime() : NaN;
  const bt = typeof b === 'string' && b ? new Date(b).getTime() : NaN;
  if (!Number.isFinite(at)) return Number.isFinite(bt) ? (b as string) : '';
  if (!Number.isFinite(bt)) return a as string;
  return at >= bt ? (a as string) : (b as string);
}

export function formatBerlinTime(iso: string, timeZone = BERLIN_TZ): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

/** «1 Minute» / «20 Minuten». */
export function formatMinutesDe(minutes: number): string {
  return minutes === 1 ? '1 Minute' : `${minutes} Minuten`;
}

// «{minutes} Minuten», «@ Min», «{minutes}» — хвост со словом необязателен.
// Точку после «Min.» НЕ съедаем: она чаще конец предложения, чем часть сокращения.
const MINUTES_TOKEN = /(\{minutes\}|@)(\s*(Minuten|Minute|Min)\b)?/gi;
const TIME_TOKEN = /\{time\}/gi;

/**
 * Подставляет минуты и время в шаблон из админки.
 * `until` пустой/просроченный → плейсхолдеры срока просто исчезают вместе с
 * лишними пробелами (лучше короткая фраза, чем «через 0 минут»).
 */
export function formatBlockTemplate(
  template: string,
  until: string,
  now: Date = new Date()
): string {
  const minutes = remainingBlockMinutes(until, now);
  const text = template
    .replace(MINUTES_TOKEN, minutes > 0 ? formatMinutesDe(minutes) : '')
    .replace(TIME_TOKEN, minutes > 0 ? formatBerlinTime(until) : '');
  // Схлопываем дыры от пустых подстановок: «Versuchen Sie es in .» → «Versuchen Sie es.»
  return text
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
