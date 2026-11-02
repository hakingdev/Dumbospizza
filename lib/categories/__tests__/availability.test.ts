// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  availabilityBadge,
  buildCategoryHours,
  intersectWeeklySchedules,
  scheduleClosedOrderMessage,
  scheduleClosureFor,
} from '../availability';
import { emptyWeeklySchedule, type WeeklySchedule } from '../../opening-schedule';

/**
 * Окна категорий по недельному графику. Ноябрь 2026 — зимнее время,
 * Берлин = UTC+1. 02.11.2026 — понедельник.
 */
const at = (isoLocal: string) => new Date(`${isoLocal}+01:00`);

function week(ranges: Partial<WeeklySchedule>): WeeklySchedule {
  return { ...emptyWeeklySchedule(), ...ranges };
}

const daily = (start: string, end: string): WeeklySchedule =>
  week({
    mon: [{ start, end }],
    tue: [{ start, end }],
    wed: [{ start, end }],
    thu: [{ start, end }],
    fri: [{ start, end }],
    sat: [{ start, end }],
    sun: [{ start, end }],
  });

const store = {
  ordersWeeklySchedule: daily('11:00', '22:00'),
  ordersTimeZone: 'Europe/Berlin',
};

const weekdaysEvening = week({
  mon: [{ start: '17:00', end: '22:00' }],
  tue: [{ start: '17:00', end: '22:00' }],
  wed: [{ start: '17:00', end: '22:00' }],
  thu: [{ start: '17:00', end: '22:00' }],
  fri: [{ start: '17:00', end: '22:00' }],
});

const categories = [
  { _id: 'burger', name: 'Burger', availabilitySchedule: weekdaysEvening },
  { _id: 'pizza', name: 'Pizza' },
  {
    _id: 'maki',
    name: 'MakiLove Sushi',
    subcategories: [
      { id: 'sushi-burgers', name: 'Sushi Burgers', order: 0, availabilitySchedule: daily('17:00', '23:00') },
      { id: 'philadelphia', name: 'Philadelphia', order: 1 },
    ],
  },
];

describe('intersectWeeklySchedules', () => {
  it('оставляет только время, когда открыты оба графика', () => {
    const result = intersectWeeklySchedules(daily('11:00', '22:00'), week({
      mon: [{ start: '17:00', end: '23:00' }],
      sat: [{ start: '09:00', end: '12:00' }, { start: '18:00', end: '00:00' }],
    }));
    expect(result.mon).toEqual([{ start: '17:00', end: '22:00' }]);
    expect(result.sat).toEqual([
      { start: '11:00', end: '12:00' },
      { start: '18:00', end: '22:00' },
    ]);
    expect(result.tue).toEqual([]);
  });

  it('понимает конец 00:00 как полночь', () => {
    const result = intersectWeeklySchedules(
      week({ sat: [{ start: '17:00', end: '00:00' }] }),
      week({ sat: [{ start: '20:00', end: '00:00' }] })
    );
    expect(result.sat).toEqual([{ start: '20:00', end: '00:00' }]);
  });
});

describe('buildCategoryHours + scheduleClosureFor', () => {
  it('категория без графика не ограничена', () => {
    const hours = buildCategoryHours(categories, store, at('2026-11-02T10:00:00'));
    expect(hours.categories.pizza).toBeUndefined();
    expect(scheduleClosureFor({ categoryId: 'pizza' }, hours)).toBeNull();
  });

  it('утром бургеры закрыты до 17:00', () => {
    const hours = buildCategoryHours(categories, store, at('2026-11-02T10:00:00'));
    const closure = scheduleClosureFor({ categoryId: 'burger' }, hours);
    expect(closure?.name).toBe('Burger');
    expect(closure?.nextOpening).toEqual({ daysAhead: 0, day: 'mon', time: '17:00' });
    expect(availabilityBadge(closure!)).toBe('Erhältlich ab 17:00');
  });

  it('в окне бургеры доступны', () => {
    const hours = buildCategoryHours(categories, store, at('2026-11-02T18:30:00'));
    expect(scheduleClosureFor({ categoryId: 'burger' }, hours)).toBeNull();
  });

  it('после окна — «Wieder morgen», в пятницу вечером — «Wieder am Mo»', () => {
    const monday = buildCategoryHours(categories, store, at('2026-11-02T22:10:00'));
    expect(availabilityBadge(scheduleClosureFor({ categoryId: 'burger' }, monday)!)).toBe(
      'Wieder morgen ab 17:00'
    );
    const friday = buildCategoryHours(categories, store, at('2026-11-06T22:10:00'));
    expect(availabilityBadge(scheduleClosureFor({ categoryId: 'burger' }, friday)!)).toBe(
      'Wieder am Mo ab 17:00'
    );
  });

  it('окно категории только сужает часы ресторана', () => {
    // Суши-бургеры 17–23, ресторан до 22: в 22:30 уже нельзя.
    const hours = buildCategoryHours(categories, store, at('2026-11-02T22:30:00'));
    const closure = scheduleClosureFor({ categoryId: 'maki', subcategoryId: 'sushi-burgers' }, hours);
    expect(closure?.name).toBe('Sushi Burgers');
    expect(closure?.lines).toEqual(['Mo–So 17:00–22:00']);
  });

  it('подкатегория закрыта, остальная категория открыта', () => {
    const hours = buildCategoryHours(categories, store, at('2026-11-02T12:00:00'));
    expect(
      scheduleClosureFor({ categoryId: 'maki', subcategoryId: 'sushi-burgers' }, hours)?.name
    ).toBe('Sushi Burgers');
    expect(scheduleClosureFor({ categoryId: 'maki', subcategoryId: 'philadelphia' }, hours)).toBeNull();
    expect(scheduleClosureFor({ categoryId: 'maki' }, hours)).toBeNull();
  });

  it('закрытая категория важнее подкатегории', () => {
    const hours = buildCategoryHours(
      [
        {
          _id: 'burger',
          name: 'Burger',
          availabilitySchedule: weekdaysEvening,
          subcategories: [{ id: 'veggie', name: 'Veggie', availabilitySchedule: daily('11:00', '22:00') }],
        },
      ],
      store,
      at('2026-11-02T12:00:00')
    );
    // Подкатегория шире категории — всё равно закрыто окном категории.
    expect(hours.subcategories.veggie.open).toBe(false);
    expect(scheduleClosureFor({ categoryId: 'burger', subcategoryId: 'veggie' }, hours)?.name).toBe('Burger');
  });

  it('пустой день графика = в этот день не продаём', () => {
    const hours = buildCategoryHours(categories, store, at('2026-11-07T18:00:00')); // суббота
    const closure = scheduleClosureFor({ categoryId: 'burger' }, hours);
    expect(availabilityBadge(closure!)).toBe('Wieder am Mo ab 17:00');
    expect(closure?.lines).toEqual(['Mo–Fr 17:00–22:00', 'Sa, So nicht erhältlich']);
  });

  it('график без единого дня — «Derzeit nicht erhältlich»', () => {
    const hours = buildCategoryHours(
      [{ _id: 'x', name: 'X', availabilitySchedule: emptyWeeklySchedule() }],
      store,
      at('2026-11-02T18:00:00')
    );
    expect(availabilityBadge(scheduleClosureFor({ categoryId: 'x' }, hours)!)).toBe(
      'Derzeit nicht erhältlich'
    );
  });

  it('битый график не ограничивает категорию', () => {
    const hours = buildCategoryHours(
      [{ _id: 'x', name: 'X', availabilitySchedule: { mon: 'oops' } }],
      store,
      at('2026-11-02T10:00:00')
    );
    expect(hours.categories.x).toBeUndefined();
  });
});

describe('scheduleClosedOrderMessage', () => {
  const window = { name: 'Burger', open: false, nextOpening: { daysAhead: 0, day: 'mon' as const, time: '17:00' }, lines: [] };

  it('одна позиция', () => {
    expect(scheduleClosedOrderMessage([{ name: 'Cheeseburger', window }])).toBe(
      '„Cheeseburger“ – Erhältlich ab 17:00. Bitte entfernen Sie den Artikel aus dem Warenkorb.'
    );
  });

  it('несколько позиций', () => {
    expect(
      scheduleClosedOrderMessage([
        { name: 'Cheeseburger', window },
        { name: 'Veggie Burger', window },
      ])
    ).toBe(
      '„Cheeseburger“ – Erhältlich ab 17:00; „Veggie Burger“ – Erhältlich ab 17:00. Bitte entfernen Sie diese Artikel aus dem Warenkorb.'
    );
  });
});
