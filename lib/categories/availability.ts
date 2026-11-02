/**
 * Доступность категорий и подкатегорий по недельному графику: бургеры — только
 * 17–22, утром их не заказать. Формат графика тот же, что у приёма заказов
 * (lib/opening-schedule): по дням, до 4 интервалов, без перехода через полночь.
 * Нет графика — ограничения нет; график есть, а день пустой — в этот день не продаём.
 *
 * Окно категории только СУЖАЕТ приём: действующий график товара — пересечение
 * часов ресторана, графика категории и графика подкатегории. Поэтому плашка
 * «Erhältlich ab …» не обещает время, когда ресторан закрыт.
 *
 * Модуль ЧИСТЫЙ: сервер заказов, /api/kitchen/blocks, мобильный bootstrap,
 * каталоги акций и повтор заказа судят одной функцией.
 */

import {
  WEEKDAY_KEYS,
  emptyWeeklySchedule,
  formatScheduleLines,
  getOrderHoursState,
  normalizeWeeklySchedule,
  rangeEndMinutes,
  rangeStartMinutes,
  resolveWeeklySchedule,
  toHHmm,
  validateWeeklySchedule,
  weekdayLabel,
  type WeekdayKey,
  type WeeklySchedule,
} from '../opening-schedule';

export interface CategoryWindow {
  name: string;
  /** Сейчас можно заказывать (с учётом часов ресторана). */
  open: boolean;
  /** Ближайшее открытие, когда закрыто; null — открыто или в графике нет ни дня. */
  nextOpening: { daysAhead: number; day: WeekdayKey; time: string } | null;
  /** Действующий график строками: «Mo–Fr 17:00–22:00», «Sa, So nicht erhältlich». */
  lines: string[];
}

export interface CategoryHours {
  /** categoryId → окно; только категории со своим графиком. */
  categories: Record<string, CategoryWindow>;
  /** subcategoryId → окно (уже с окном категории); только подкатегории с графиком. */
  subcategories: Record<string, CategoryWindow>;
}

export const EMPTY_CATEGORY_HOURS: CategoryHours = { categories: {}, subcategories: {} };

export interface AvailabilityItem {
  categoryId?: string | null;
  subcategoryId?: string | null;
}

/** График категории/подкатегории из БД или формы; мусор и «нет графика» → null. */
export function readAvailabilitySchedule(raw: unknown): WeeklySchedule | null {
  return normalizeWeeklySchedule(raw);
}

/**
 * Графики из формы админки — категории и каждой подкатегории. null — «без
 * ограничения». Ошибка — первая найденная, по-русски, с именем подкатегории.
 */
export function validateCategoryAvailability(input: {
  availabilitySchedule?: unknown;
  subcategories?: unknown;
}): { error: string | null; availabilitySchedule: WeeklySchedule | null } {
  let availabilitySchedule: WeeklySchedule | null = null;
  if (input.availabilitySchedule != null) {
    const { schedule, errors } = validateWeeklySchedule(input.availabilitySchedule);
    if (!schedule) {
      return { error: `Время продажи категории: ${errors[0].message}`, availabilitySchedule: null };
    }
    availabilitySchedule = schedule;
  }

  const subcategories = Array.isArray(input.subcategories) ? input.subcategories : [];
  for (const sub of subcategories as any[]) {
    if (sub?.availabilitySchedule == null) continue;
    const { schedule, errors } = validateWeeklySchedule(sub.availabilitySchedule);
    if (!schedule) {
      return {
        error: `Время продажи «${String(sub?.name ?? '').trim()}»: ${errors[0].message}`,
        availabilitySchedule: null,
      };
    }
  }

  return { error: null, availabilitySchedule };
}

/** Пересечение двух графиков по дням: время, когда открыты ОБА. */
export function intersectWeeklySchedules(a: WeeklySchedule, b: WeeklySchedule): WeeklySchedule {
  const result = emptyWeeklySchedule();
  for (const day of WEEKDAY_KEYS) {
    const ranges: Array<{ start: number; end: number }> = [];
    for (const x of a[day]) {
      for (const y of b[day]) {
        const start = Math.max(rangeStartMinutes(x), rangeStartMinutes(y));
        const end = Math.min(rangeEndMinutes(x), rangeEndMinutes(y));
        if (end > start) ranges.push({ start, end });
      }
    }
    ranges.sort((r1, r2) => r1.start - r2.start);
    result[day] = ranges.map((r) => ({ start: toHHmm(r.start), end: toHHmm(r.end) }));
  }
  return result;
}

function toWindow(name: string, schedule: WeeklySchedule, timeZone: string | undefined, now: Date): CategoryWindow {
  const state = getOrderHoursState(schedule, timeZone, now);
  return {
    name,
    open: state.open,
    nextOpening: state.open ? null : state.nextOpening,
    lines: formatScheduleLines(schedule, { locale: 'de', closedLabel: 'nicht erhältlich' }),
  };
}

export interface ScheduledCategoryLike {
  _id?: unknown;
  id?: unknown;
  name?: unknown;
  availabilitySchedule?: unknown;
  subcategories?: unknown;
}

/**
 * Окна всех категорий и подкатегорий, у которых задан график, на момент now.
 * storeSettings — для часов ресторана и часового пояса.
 */
export function buildCategoryHours(
  categories: ScheduledCategoryLike[] | null | undefined,
  storeSettings: Record<string, any> | null | undefined,
  now: Date
): CategoryHours {
  const store = resolveWeeklySchedule(storeSettings);
  const timeZone = storeSettings?.ordersTimeZone;
  const hours: CategoryHours = { categories: {}, subcategories: {} };

  for (const category of categories || []) {
    const id = String(category?._id ?? category?.id ?? '');
    if (!id) continue;
    const own = readAvailabilitySchedule(category.availabilitySchedule);
    const base = own ? intersectWeeklySchedules(store, own) : store;
    if (own) hours.categories[id] = toWindow(String(category.name ?? ''), base, timeZone, now);

    const subcategories = Array.isArray(category.subcategories) ? category.subcategories : [];
    for (const sub of subcategories as any[]) {
      const schedule = readAvailabilitySchedule(sub?.availabilitySchedule);
      if (!sub?.id || !schedule) continue;
      hours.subcategories[String(sub.id)] = toWindow(
        String(sub.name ?? ''),
        intersectWeeklySchedules(base, schedule),
        timeZone,
        now
      );
    }
  }
  return hours;
}

/** Закрытое сейчас окно позиции (сперва категория, потом подкатегория); null — можно заказать. */
export function scheduleClosureFor(
  item: AvailabilityItem,
  hours: CategoryHours | null | undefined
): CategoryWindow | null {
  if (!hours) return null;
  const category = item.categoryId ? hours.categories[String(item.categoryId)] : undefined;
  if (category && !category.open) return category;
  const sub = item.subcategoryId ? hours.subcategories[String(item.subcategoryId)] : undefined;
  if (sub && !sub.open) return sub;
  return null;
}

/** Плашка на карточке: «Erhältlich ab 17:00», «Wieder morgen ab 17:00», «Wieder am Mo ab 17:00». */
export function availabilityBadge(window: Pick<CategoryWindow, 'nextOpening'>): string {
  const next = window.nextOpening;
  if (!next) return 'Derzeit nicht erhältlich';
  if (next.daysAhead === 0) return `Erhältlich ab ${next.time}`;
  if (next.daysAhead === 1) return `Wieder morgen ab ${next.time}`;
  return `Wieder am ${weekdayLabel(next.day, 'de', 'short')} ab ${next.time}`;
}

/** Коротко — у названия категории/подкатегории: «ab 17:00», «morgen ab 17:00», «Mo ab 17:00». */
export function availabilityShortBadge(window: Pick<CategoryWindow, 'nextOpening'>): string {
  const next = window.nextOpening;
  if (!next) return 'nicht erhältlich';
  if (next.daysAhead === 0) return `ab ${next.time}`;
  if (next.daysAhead === 1) return `morgen ab ${next.time}`;
  return `${weekdayLabel(next.day, 'de', 'short')} ab ${next.time}`;
}

/** Отказ сервера: «„Sushi Burger“ – Erhältlich ab 17:00. Bitte entfernen Sie den Artikel …». */
export function scheduleClosedOrderMessage(
  entries: Array<{ name: string; window: CategoryWindow }>
): string {
  const list = entries.map((e) => `„${e.name}“ – ${availabilityBadge(e.window)}`).join('; ');
  const tail =
    entries.length > 1
      ? 'Bitte entfernen Sie diese Artikel aus dem Warenkorb.'
      : 'Bitte entfernen Sie den Artikel aus dem Warenkorb.';
  return `${list}. ${tail}`;
}

/** Кнопка «Zur Kasse», пока в корзине есть позиции вне времени продажи. */
export const SCHEDULE_CLOSED_HEADLINE = 'Nicht alle Artikel bestellbar';

/** Над кнопкой «Zur Kasse»: что в корзине сейчас не продаётся и когда будет. */
export function scheduleClosedCartMessage(windows: CategoryWindow[]): string {
  const list = windows.map((w) => `${w.name} – ${availabilityBadge(w)}`).join('; ');
  return `Gerade nicht bestellbar: ${list}. Bitte entfernen Sie diese Artikel, um fortzufahren.`;
}
