/**
 * Дата/время акций для гостя: «29.12.2026» или «29.12.2026, 18:00 Uhr».
 * toLocaleString('de-DE') на сервере печатал секунды и время в поясе сервера
 * (UTC на Vercel), а не Bad Kissingen.
 */
const PARTS = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatPromoDate(value: string | number | Date | null | undefined): string {
  if (value == null || value === '') return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(PARTS.formatToParts(date).map((p) => [p.type, p.value]));
  const day = `${parts.day}.${parts.month}.${parts.year}`;
  const time = `${parts.hour}:${parts.minute}`;
  // Граница суток — это «весь день», время только мешает.
  return time === '00:00' || time === '23:59' ? day : `${day}, ${time} Uhr`;
}
