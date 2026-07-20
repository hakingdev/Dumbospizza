import { describe, it, expect } from 'vitest';
import {
  isBannerVisible,
  normalizeActiveDays,
  resolveActiveDays,
  formatWeekdayLabel,
  ALL_WEEKDAYS,
} from '../visibility';

// 2026-07-20 — понедельник; 2026-07-21 — вторник, 2026-07-22 — среда.
const MONDAY = new Date('2026-07-20T12:00:00Z');
const TUESDAY = new Date('2026-07-21T12:00:00Z');
const WEDNESDAY = new Date('2026-07-22T12:00:00Z');

describe('isBannerVisible', () => {
  it('показывает баннер со всеми семью днями — «каждый день»', () => {
    expect(isBannerVisible({ enabled: true, activeDaysOfWeek: ALL_WEEKDAYS }, MONDAY)).toBe(true);
    expect(isBannerVisible({ enabled: true, activeDaysOfWeek: ALL_WEEKDAYS }, WEDNESDAY)).toBe(true);
  });

  it('показывает баннер «только Пн и Вт» в эти дни и прячет в остальные', () => {
    const banner = { enabled: true, activeDaysOfWeek: [1, 2] };
    expect(isBannerVisible(banner, MONDAY)).toBe(true);
    expect(isBannerVisible(banner, TUESDAY)).toBe(true);
    expect(isBannerVisible(banner, WEDNESDAY)).toBe(false);
  });

  it('прячет выключенный баннер даже в его день', () => {
    expect(isBannerVisible({ enabled: false, activeDaysOfWeek: [1] }, MONDAY)).toBe(false);
  });

  it('считает день недели по Берлину, а не по UTC-зоне сервера', () => {
    // Пн 23:30 по Берлину = Пн 21:30 UTC — ещё понедельник в обеих зонах.
    expect(isBannerVisible({ enabled: true, activeDaysOfWeek: [1] }, new Date('2026-07-20T21:30:00Z'))).toBe(true);
    // Вт 00:30 по Берлину = Пн 22:30 UTC — по UTC ещё понедельник, по Берлину уже вторник.
    expect(isBannerVisible({ enabled: true, activeDaysOfWeek: [1] }, new Date('2026-07-20T22:30:00Z'))).toBe(false);
    expect(isBannerVisible({ enabled: true, activeDaysOfWeek: [2] }, new Date('2026-07-20T22:30:00Z'))).toBe(true);
  });

  it('уважает нестандартную зону баннера', () => {
    const banner = { enabled: true, activeDaysOfWeek: [2], scheduleTimeZone: 'Australia/Sydney' };
    // Пн 22:30 UTC = вторник 08:30 в Сиднее.
    expect(isBannerVisible(banner, new Date('2026-07-20T22:30:00Z'))).toBe(true);
  });

  it('не прячет баннер молча при пустом или кривом расписании', () => {
    expect(isBannerVisible({ enabled: true, activeDaysOfWeek: [] }, WEDNESDAY)).toBe(true);
    expect(isBannerVisible({ enabled: true, activeDaysOfWeek: null }, WEDNESDAY)).toBe(true);
    expect(isBannerVisible({ enabled: true, activeDaysOfWeek: 'пн,вт' }, WEDNESDAY)).toBe(true);
    expect(isBannerVisible({ enabled: true }, WEDNESDAY)).toBe(true);
  });
});

describe('normalizeActiveDays', () => {
  it('чистит список: сортирует, убирает дубли и значения вне 0–6', () => {
    expect(normalizeActiveDays([3, 1, 1, 9, -2, 6])).toEqual([1, 3, 6]);
  });

  it('принимает числа-строки — форма может прислать их как есть', () => {
    expect(normalizeActiveDays(['1', '2'])).toEqual([1, 2]);
  });

  it('отбрасывает мусор поштучно, а не весь список целиком', () => {
    expect(normalizeActiveDays([1, 'вторник', 2.5, null, 5])).toEqual([1, 5]);
  });

  it('на не-массиве возвращает пустой список, а не падает', () => {
    expect(normalizeActiveDays(undefined)).toEqual([]);
    expect(normalizeActiveDays({ mo: true })).toEqual([]);
  });
});

describe('resolveActiveDays', () => {
  it('пустое расписание разворачивает в «каждый день»', () => {
    expect(resolveActiveDays([])).toEqual(ALL_WEEKDAYS);
    expect(resolveActiveDays(undefined)).toEqual(ALL_WEEKDAYS);
  });

  it('непустое расписание оставляет как есть', () => {
    expect(resolveActiveDays([2, 1])).toEqual([1, 2]);
  });
});

describe('formatWeekdayLabel', () => {
  it('все семь дней — «Каждый день»', () => {
    expect(formatWeekdayLabel(ALL_WEEKDAYS)).toBe('Каждый день');
    expect(formatWeekdayLabel(ALL_WEEKDAYS, 'de')).toBe('Täglich');
  });

  it('перечисляет дни с понедельника, а не с воскресенья', () => {
    expect(formatWeekdayLabel([0, 1, 2])).toBe('Пн, Вт, Вс');
    expect(formatWeekdayLabel([1, 2], 'de')).toBe('Mo, Di');
  });
});
