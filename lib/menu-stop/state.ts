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
 * выключил сам, и до какого времени — конец рабочего дня по графику приёма
 * (`until`), либо бессрочно (`until: null`). Крон (app/api/cron/menu-stop-expire)
 * и сами экраны бота включают обратно то, чей срок прошёл; бессрочное ждёт
 * кнопки «включить». Включить раньше можно кнопкой бота или в админке: панель
 * показывает реальный флаг, а запись бота — только подсказку «до HH:MM» /
 * «бессрочно». Ключ свой, не storeSettings: его целиком перезаписывает старая
 * админка настроек, а блокировки цехов живут там же read-modify-write'ом.
 *
 * Режим кнопок (`mode`) хранится в том же ключе: «до конца дня» (по умолчанию)
 * или «бессрочно». Ночной крон возвращает режим на «до конца дня», чтобы
 * случайно не оставить позицию выключенной навсегда.
 *
 * Lieferando Partner Hub включает всё выключенное обратно каждое утро — поэтому
 * бессрочный стоп там держится утренним кроном (app/api/cron/menu-stop-reapply),
 * который заново ставит агенту команды off (см. ./reapply).
 */
import { rangeEndMinutes, resolveWeeklySchedule, weekdayKeyFromJsDay } from '../opening-schedule';
import { getDayOfWeekInTimeZone, getNowMinutesInTimeZone } from '../order-acceptance-hours';

export const MENU_STOP_KEY = 'menuStopBot';
const DEFAULT_TZ = 'Europe/Berlin';
const DAY_MINUTES = 24 * 60;

/** Режим кнопок бота: выключать до конца рабочего дня или бессрочно. */
export type MenuStopMode = 'day' | 'indefinite';

/**
 * Что выключил бот: до когда (ISO) или бессрочно (`until: null`), и как
 * называлось — для отчётов в группу.
 */
export interface MenuStopEntry {
  until: string | null;
  name: string;
}

export interface MenuStopState {
  mode: MenuStopMode;
  /** variationId библиотеки размеров → запись */
  sizes: Record<string, MenuStopEntry>;
  /** productId → запись */
  products: Record<string, MenuStopEntry>;
  /** день (YYYY-MM-DD в зоне ресторана), когда утреннее перевыключение уже выполнялось */
  reapplyDay: string | null;
}

export const EMPTY_MENU_STOP_STATE: MenuStopState = {
  mode: 'day',
  sizes: {},
  products: {},
  reapplyDay: null,
};

export const isIndefiniteStop = (entry: MenuStopEntry): boolean => entry.until === null;

function readEntries(raw: unknown): Record<string, MenuStopEntry> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, MenuStopEntry> = {};
  for (const [id, value] of Object.entries(raw as Record<string, any>)) {
    if (!id || !value || typeof value !== 'object') continue;
    const name = typeof value.name === 'string' ? value.name : '';
    // Бессрочно: until = null (канон) либо флаг indefinite — на случай ручной правки ключа.
    if (value.until === null || value.indefinite === true) {
      out[id] = { until: null, name };
      continue;
    }
    if (typeof value.until !== 'string' || isNaN(new Date(value.until).getTime())) continue;
    out[id] = { until: value.until, name };
  }
  return out;
}

/** Мусор из БД не должен ронять ни бота, ни крон. */
export function readMenuStopState(raw: unknown): MenuStopState {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  return {
    mode: s.mode === 'indefinite' ? 'indefinite' : 'day',
    sizes: readEntries(s.sizes),
    products: readEntries(s.products),
    reapplyDay: typeof s.reapplyDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.reapplyDay) ? s.reapplyDay : null,
  };
}

/** Календарная дата в зоне ресторана — ключ «сегодня уже делали». */
export function dayKeyInTimeZone(timeZone: string, now: Date): string {
  // en-CA даёт YYYY-MM-DD без разбора по частям.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Утреннее перевыключение бессрочного стоп-листа на Lieferando запускается из
 * поллинга агента (раз в день, после этого часа по зоне ресторана): Hub
 * возвращает всё в продажу «к концу дня», ресторан открывается не раньше 11:00.
 */
export const REAPPLY_AFTER_MINUTES = 8 * 60 + 30;

/** Пора ли сегодня перевыключать: уже после REAPPLY_AFTER и сегодня ещё не делали. */
export function reapplyDue(
  state: Pick<MenuStopState, 'reapplyDay'>,
  settings: Record<string, any> | null | undefined,
  now: Date = new Date()
): boolean {
  const tz: string = settings?.ordersTimeZone || DEFAULT_TZ;
  if (getNowMinutesInTimeZone(tz, now) < REAPPLY_AFTER_MINUTES) return false;
  return state.reapplyDay !== dayKeyInTimeZone(tz, now);
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

/** Записи, чей срок прошёл — их пора включить обратно. Бессрочные не истекают. */
export function expiredMenuStops(
  state: MenuStopState,
  now: Date = new Date()
): { sizes: string[]; products: string[] } {
  const expired = (entries: Record<string, MenuStopEntry>) =>
    Object.entries(entries)
      .filter(
        ([, entry]) => entry.until !== null && new Date(entry.until).getTime() <= now.getTime()
      )
      .map(([id]) => id);
  return { sizes: expired(state.sizes), products: expired(state.products) };
}

/** Запись бота по id с именем — для крона и отчётов. */
export interface MenuStopNamed {
  id: string;
  name: string;
}

/** Бессрочные записи — их утренний крон перевыключает на Lieferando. */
export function indefiniteMenuStops(state: MenuStopState): {
  sizes: MenuStopNamed[];
  products: MenuStopNamed[];
} {
  const pick = (entries: Record<string, MenuStopEntry>) =>
    Object.entries(entries)
      .filter(([, entry]) => isIndefiniteStop(entry))
      .map(([id, entry]) => ({ id, name: entry.name }));
  return { sizes: pick(state.sizes), products: pick(state.products) };
}

// --- строки экранов бота (их отдаёт сервис, рисует telegram-control) -----------

/**
 * Чем выключено: ботом до `until` (ISO), ботом бессрочно (`until: null`) или
 * не ботом — руками в админке/POS (`null`). Для включённых строк всегда null.
 */
export type MenuBotStop = { until: string | null } | null;

export interface MenuSizeRow {
  id: string;
  name: string;
  label: string;
  active: boolean;
  botStop: MenuBotStop;
}

export interface MenuCategoryRow {
  id: string;
  name: string;
  itemCount: number;
  stoppedCount: number;
  /**
   * Категория есть только на Lieferando (из снимка каталога, lib/lieferando/catalog):
   * id — hub-c<хэш>, позиции в ней — только Hub-строки.
   */
  hubOnly?: boolean;
}

export interface MenuItemRow {
  id: string;
  name: string;
  categoryId: string;
  available: boolean;
  botStop: MenuBotStop;
  /**
   * Позиция есть только на Lieferando (нет товара на сайте): id — hub-i<хэш>,
   * name — точное имя из Hub, available — общий переключатель по снимку.
   * Кнопка ставит агенту команду item с этим именем; на сайте переключать нечего.
   */
  hubOnly?: boolean;
}

/** Экран категории: строки сайта + Hub-строки без пары (hubOnly) и время снимка Hub. */
export interface MenuCategoryItems {
  category: MenuCategoryRow | null;
  items: MenuItemRow[];
  /** takenAt снимка каталога Lieferando, если в списке есть Hub-строки */
  hubSnapshotAt?: string | null;
}

/** Порт, через который экраны бота ходят к флагам (живая реализация — ./service). */
export interface MenuStopPort {
  /** Режим кнопок «выключить»: до конца дня или бессрочно (хранится в ключе). */
  getMode(): PromiseLike<MenuStopMode>;
  setMode(mode: MenuStopMode): PromiseLike<MenuStopMode>;
  listSizes(): PromiseLike<MenuSizeRow[]>;
  /** Выключение берёт срок из текущего режима; включение снимает запись бота. */
  setSizeActive(variationId: string, active: boolean): PromiseLike<MenuSizeRow | null>;
  /** Категории сайта + виртуальные категории Hub (hubOnly), где есть строки без пары. */
  listCategories(): PromiseLike<MenuCategoryRow[]>;
  listCategoryItems(categoryId: string): PromiseLike<MenuCategoryItems>;
  /**
   * id товара сайта — флаг available (+ запись бота); id hub-i… — только
   * состояние в снимке Lieferando (оптимистично) и запись бота в режиме «бессрочно».
   */
  setItemAvailable(productId: string, available: boolean): PromiseLike<MenuItemRow | null>;
  /** Включает все выключенные позиции категории (и Hub-строки без пары); возвращает включённые. */
  enableCategoryItems(categoryId: string): PromiseLike<MenuItemRow[]>;
}

/**
 * Цель команды агенту Lieferando — структурная копия контракта
 * `LieferandoTarget` из lib/lieferando-makilove.ts: size — имя размера сайта
 * («30 cm», «ca. 27x37»), агент матчит варианты Hub по числам; item — имена
 * товаров сайта, агент матчит строки Hub нормализованно (без «Pizza»,
 * «(rund)», регистра); catalog — снимок каталога Hub (ничего не переключает).
 */
export type LieferandoMenuTarget =
  | { kind: 'makilove' }
  | { kind: 'size'; label: string }
  | { kind: 'item'; names: string[] }
  | { kind: 'catalog' };

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
