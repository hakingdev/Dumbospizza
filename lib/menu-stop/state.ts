/**
 * Стоп размеров и позиций из Telegram-стоп-бота — ЧИСТАЯ часть (без БД).
 *
 * Бот переключает ТЕ ЖЕ флаги, что админка и кухонный терминал:
 *   - `active` размера в библиотеке size_variations — выключает размер сразу
 *     у всех товаров (applySizeVariationStates перекрывает копии в товарах);
 *   - `available` товара.
 * Один источник правды: витрина, приём заказов, POS и админка ничего нового
 * не читают.
 *
 * Отдельно, в ключе настроек `menuStopBot`, бот запоминает ТОЛЬКО то, что
 * выключил сам, и до какого времени — конец рабочего дня по графику приёма.
 * Крон (app/api/cron/menu-stop-expire) и сами экраны бота включают это
 * обратно, когда срок прошёл. Включить раньше можно кнопкой бота или в
 * админке: панель показывает реальный флаг, а запись бота — только подсказку
 * «до HH:MM». Ключ свой, не storeSettings: его целиком перезаписывает старая
 * админка настроек, а блокировки цехов живут там же read-modify-write'ом.
 */
import { rangeEndMinutes, resolveWeeklySchedule, weekdayKeyFromJsDay } from '../opening-schedule';
import { getDayOfWeekInTimeZone, getNowMinutesInTimeZone } from '../order-acceptance-hours';

export const MENU_STOP_KEY = 'menuStopBot';
const DEFAULT_TZ = 'Europe/Berlin';
const DAY_MINUTES = 24 * 60;

/** Что выключил бот: до когда (ISO) и как называлось — для отчёта утром. */
export interface MenuStopEntry {
  until: string;
  name: string;
}

export interface MenuStopState {
  /** variationId библиотеки размеров → запись */
  sizes: Record<string, MenuStopEntry>;
  /** productId → запись */
  products: Record<string, MenuStopEntry>;
}

export const EMPTY_MENU_STOP_STATE: MenuStopState = { sizes: {}, products: {} };

function readEntries(raw: unknown): Record<string, MenuStopEntry> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, MenuStopEntry> = {};
  for (const [id, value] of Object.entries(raw as Record<string, any>)) {
    if (!id || !value || typeof value !== 'object') continue;
    if (typeof value.until !== 'string' || isNaN(new Date(value.until).getTime())) continue;
    out[id] = { until: value.until, name: typeof value.name === 'string' ? value.name : '' };
  }
  return out;
}

/** Мусор из БД не должен ронять ни бота, ни крон. */
export function readMenuStopState(raw: unknown): MenuStopState {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  return { sizes: readEntries(s.sizes), products: readEntries(s.products) };
}

/**
 * Конец рабочего дня: конец последней ещё не закончившейся смены сегодня по
 * графику приёма (Europe/Berlin). После закрытия или в выходной — конец
 * календарных суток, чтобы «до конца дня» никогда не оказалось в прошлом.
 * Считаем сдвигом от текущей минуты в зоне, а не сборкой даты по частям: это
 * верно всегда, кроме двух ночей перевода часов, когда ресторан закрыт.
 */
export function endOfBusinessDay(
  settings: Record<string, any> | null | undefined,
  now: Date = new Date()
): Date {
  const tz: string = settings?.ordersTimeZone || DEFAULT_TZ;
  const schedule = resolveWeeklySchedule(settings);
  const today = weekdayKeyFromJsDay(getDayOfWeekInTimeZone(tz, now));
  const nowMinutes = getNowMinutesInTimeZone(tz, now);
  const ends = schedule[today].map(rangeEndMinutes).filter((end) => end > nowMinutes);
  const endMinutes = ends.length ? Math.max(...ends) : DAY_MINUTES;
  const minuteStart = new Date(now.getTime());
  minuteStart.setUTCSeconds(0, 0);
  return new Date(minuteStart.getTime() + (endMinutes - nowMinutes) * 60_000);
}

/** Записи, чей срок прошёл — их пора включить обратно. */
export function expiredMenuStops(
  state: MenuStopState,
  now: Date = new Date()
): { sizes: string[]; products: string[] } {
  const expired = (entries: Record<string, MenuStopEntry>) =>
    Object.entries(entries)
      .filter(([, entry]) => new Date(entry.until).getTime() <= now.getTime())
      .map(([id]) => id);
  return { sizes: expired(state.sizes), products: expired(state.products) };
}

// --- строки экранов бота (их отдаёт сервис, рисует telegram-control) -----------

export interface MenuSizeRow {
  id: string;
  name: string;
  label: string;
  active: boolean;
  /** ISO, если размер выключен и выключил его бот; иначе null */
  stoppedUntil: string | null;
}

export interface MenuCategoryRow {
  id: string;
  name: string;
  itemCount: number;
  stoppedCount: number;
}

export interface MenuItemRow {
  id: string;
  name: string;
  categoryId: string;
  available: boolean;
  /** ISO, если позиция выключена и выключил её бот; иначе null */
  stoppedUntil: string | null;
}

/** Порт, через который экраны бота ходят к флагам (живая реализация — ./service). */
export interface MenuStopPort {
  listSizes(): PromiseLike<MenuSizeRow[]>;
  setSizeActive(variationId: string, active: boolean): PromiseLike<MenuSizeRow | null>;
  listCategories(): PromiseLike<MenuCategoryRow[]>;
  listCategoryItems(
    categoryId: string
  ): PromiseLike<{ category: MenuCategoryRow | null; items: MenuItemRow[] }>;
  setItemAvailable(productId: string, available: boolean): PromiseLike<MenuItemRow | null>;
  /** Включает все выключенные позиции категории; возвращает включённые. */
  enableCategoryItems(categoryId: string): PromiseLike<MenuItemRow[]>;
}

/**
 * Цель команды агенту Lieferando — структурная копия контракта
 * `LieferandoTarget` из lib/lieferando-makilove.ts: size — имя размера сайта
 * («30 cm», «ca. 27x37»), агент матчит варианты Hub по числам; item — имена
 * товаров сайта, агент матчит строки Hub нормализованно (без «Pizza»,
 * «(rund)», регистра).
 */
export type LieferandoMenuTarget =
  | { kind: 'makilove' }
  | { kind: 'size'; label: string }
  | { kind: 'item'; names: string[] };

/** Страница списка: номер зажимается в [0, pages-1], пустой список — одна страница. */
export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize: number
): { page: number; pages: number; slice: T[] } {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const safe = Math.min(Math.max(0, Math.floor(page) || 0), pages - 1);
  return { page: safe, pages, slice: items.slice(safe * pageSize, (safe + 1) * pageSize) };
}

/** Текст гостю: в корзине позиции, снятые с продажи (стоп-лист). */
export function soldOutOrderMessage(names: string[]): string {
  const list = names.map((n) => `„${n}“`).join(', ');
  return names.length > 1
    ? `${list} sind leider nicht mehr verfügbar. Bitte entfernen Sie diese Artikel aus dem Warenkorb.`
    : `${list} ist leider nicht mehr verfügbar. Bitte entfernen Sie den Artikel aus dem Warenkorb.`;
}
