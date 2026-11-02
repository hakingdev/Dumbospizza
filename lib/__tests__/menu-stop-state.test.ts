// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  EMPTY_MENU_STOP_STATE,
  endOfBusinessDay,
  expiredMenuStops,
  paginate,
  readMenuStopState,
  soldOutOrderMessage,
} from '../menu-stop/state';

/**
 * Стоп размеров/позиций из стоп-бота — чистая часть: разбор ключа menuStopBot,
 * «до конца дня» по графику приёма, просроченные записи, пагинация, текст гостю.
 */

describe('readMenuStopState', () => {
  it('мусор/пусто → пустое состояние', () => {
    expect(readMenuStopState(null)).toEqual(EMPTY_MENU_STOP_STATE);
    expect(readMenuStopState('bogus')).toEqual(EMPTY_MENU_STOP_STATE);
    expect(readMenuStopState({ sizes: [], products: 42 })).toEqual(EMPTY_MENU_STOP_STATE);
  });

  it('валидные записи проходят, битые until отбрасываются', () => {
    const s = readMenuStopState({
      sizes: { a: { until: '2026-11-02T20:30:00.000Z', name: '36 cm' }, b: { until: 'never' } },
      products: { p1: { until: '2026-11-02T20:30:00.000Z' } },
    });
    expect(s.sizes).toEqual({ a: { until: '2026-11-02T20:30:00.000Z', name: '36 cm' } });
    expect(s.products).toEqual({ p1: { until: '2026-11-02T20:30:00.000Z', name: '' } });
  });
});

describe('endOfBusinessDay', () => {
  // Понедельник: 11:00–14:00 и 17:00–21:30 по Берлину (зима: UTC+1).
  const settings = {
    ordersTimeZone: 'Europe/Berlin',
    ordersWeeklySchedule: {
      mon: [
        { start: '11:00', end: '14:00' },
        { start: '17:00', end: '21:30' },
      ],
      tue: [{ start: '17:00', end: '22:00' }],
      wed: [],
      thu: [],
      fri: [],
      sat: [],
      sun: [],
    },
  };

  it('в обед → конец ВЕЧЕРНЕЙ смены, а не обеденной', () => {
    const now = new Date('2026-11-02T11:15:30.000Z'); // пн 12:15 Берлин
    expect(endOfBusinessDay(settings, now).toISOString()).toBe('2026-11-02T20:30:00.000Z');
  });

  it('вечером → конец текущей смены', () => {
    const now = new Date('2026-11-02T18:00:00.000Z'); // пн 19:00 Берлин
    expect(endOfBusinessDay(settings, now).toISOString()).toBe('2026-11-02T20:30:00.000Z');
  });

  it('после закрытия → полночь по Берлину, не прошлое', () => {
    const now = new Date('2026-11-02T21:00:00.000Z'); // пн 22:00 Берлин
    expect(endOfBusinessDay(settings, now).toISOString()).toBe('2026-11-02T23:00:00.000Z');
  });

  it('выходной (нет смен) → полночь по Берлину', () => {
    const now = new Date('2026-11-04T10:00:00.000Z'); // ср 11:00 Берлин
    expect(endOfBusinessDay(settings, now).toISOString()).toBe('2026-11-04T23:00:00.000Z');
  });

  it('без графика — старая пара start/end (по умолчанию до 21:30)', () => {
    const now = new Date('2026-11-03T17:00:00.000Z'); // вт 18:00 Берлин
    expect(endOfBusinessDay({}, now).toISOString()).toBe('2026-11-03T20:30:00.000Z');
  });
});

describe('expiredMenuStops', () => {
  const now = new Date('2026-11-03T03:00:00.000Z');
  it('отдаёт только записи с прошедшим until', () => {
    const state = readMenuStopState({
      sizes: {
        old: { until: '2026-11-02T20:30:00.000Z', name: '36 cm' },
        fresh: { until: '2026-11-03T20:30:00.000Z', name: '40 cm' },
      },
      products: { p: { until: '2026-11-03T03:00:00.000Z', name: 'Hawaiian' } }, // ровно сейчас — тоже
    });
    expect(expiredMenuStops(state, now)).toEqual({ sizes: ['old'], products: ['p'] });
  });
  it('пусто → пусто', () => {
    expect(expiredMenuStops(EMPTY_MENU_STOP_STATE, now)).toEqual({ sizes: [], products: [] });
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 23 }, (_, i) => i);
  it('режет по страницам и зажимает номер', () => {
    expect(paginate(items, 0, 10)).toMatchObject({ page: 0, pages: 3 });
    expect(paginate(items, 2, 10).slice).toEqual([20, 21, 22]);
    expect(paginate(items, 99, 10)).toMatchObject({ page: 2, pages: 3 });
    expect(paginate(items, -5, 10)).toMatchObject({ page: 0 });
    expect(paginate(items, NaN, 10)).toMatchObject({ page: 0 });
  });
  it('пустой список — одна страница', () => {
    expect(paginate([], 3, 10)).toEqual({ page: 0, pages: 1, slice: [] });
  });
});

describe('soldOutOrderMessage', () => {
  it('единственное и множественное число', () => {
    expect(soldOutOrderMessage(['Hawaiian'])).toBe(
      '„Hawaiian“ ist leider nicht mehr verfügbar. Bitte entfernen Sie den Artikel aus dem Warenkorb.'
    );
    expect(soldOutOrderMessage(['A', 'B'])).toContain('„A“, „B“ sind leider nicht mehr verfügbar');
  });
});
