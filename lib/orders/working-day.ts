/**
 * Рабочий день ресторана — сутки, которые начинаются в 01:00 по Берлину.
 *
 * Календарная полночь здесь не подходит: смена заканчивается позже неё, и заказ,
 * принятый в 23:50, принадлежит уходящему дню, а не наступившему. Час ночи —
 * момент, когда доставки уже нет и всё незакрытое перестало быть работой.
 *
 * Модуль ЧИСТЫЙ (без базы и сети): по этой границе живут и лента терминала, и
 * уборка карточек в Telegram. Две копии этой арифметики разошлись бы на переводе
 * часов, и разошлись бы молча.
 */

const BERLIN_TZ = 'Europe/Berlin';

/** Час, в который рабочий день сменяется следующим. */
export const WORKING_DAY_START_HOUR = 1;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Как выглядит момент на часах заведения. */
function zonedParts(at: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // hourCycle h23 иногда отдаёт «24» для полуночи — приводим к нулю сами.
  const hour = get('hour') % 24;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/** На сколько часы заведения опережают UTC в этот момент, мс. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Части даны с точностью до секунды — с ней и сравниваем, иначе миллисекунды
  // исходного момента уехали бы в смещение.
  const wholeSeconds = Math.floor(at.getTime() / 1000) * 1000;
  return asUtc - wholeSeconds;
}

/**
 * Момент, когда на часах заведения было ровно `hour:00` указанной даты.
 *
 * Смещение вычисляется дважды: первый расчёт даёт приблизительный момент, а в
 * ночь перевода часов смещение в нём может быть уже другим. Второй проход берёт
 * смещение, действующее в найденной точке, и попадает точно.
 */
function instantAtZonedHour(
  year: number,
  month: number,
  day: number,
  hour: number,
  timeZone: string
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, 0, 0);
  let ts = wall;
  for (let i = 0; i < 2; i += 1) {
    ts = wall - zoneOffsetMs(new Date(ts), timeZone);
  }
  return new Date(ts);
}

/**
 * Начало текущего рабочего дня: ближайшие 01:00, которые уже наступили.
 *
 * В 00:30 это час ночи ВЧЕРАШНЕЙ даты — смена ещё идёт. В 01:30 — уже сегодняшней.
 */
export function workingDayStart(now: Date = new Date(), timeZone = BERLIN_TZ): Date {
  const p = zonedParts(now, timeZone);
  const shift = p.hour >= WORKING_DAY_START_HOUR ? 0 : -1;
  // Дату сдвигаем через UTC-полдень: он не попадает ни в один перевод часов,
  // поэтому «вчера» остаётся вчерашним числом при любом смещении.
  const noon = new Date(Date.UTC(p.year, p.month - 1, p.day, 12) + shift * 86_400_000);
  return instantAtZonedHour(
    noon.getUTCFullYear(),
    noon.getUTCMonth() + 1,
    noon.getUTCDate(),
    WORKING_DAY_START_HOUR,
    timeZone
  );
}

/** Заказ из прошедших смен — на кухне и в Telegram ему больше не место. */
export function isStaleForWorkingDay(
  value: Date | string | number | null | undefined,
  now: Date = new Date(),
  timeZone = BERLIN_TZ
): boolean {
  if (value == null) return false;
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return false;
  return at.getTime() < workingDayStart(now, timeZone).getTime();
}
