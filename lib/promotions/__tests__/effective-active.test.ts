import { describe, it, expect } from 'vitest';
import { isPromotionEffectivelyActive } from '../status';

// Базовая акция из ТЗ: период 19–30 июня, активна Mi,Do,Fr,Sa,So (Mo/Di выключены).
function basePromo(overrides: Record<string, any> = {}) {
  return {
    enabled: true,
    validFrom: new Date('2026-06-19T00:00:00.000Z'),
    validTo: new Date('2026-06-30T23:59:00.000Z'),
    weekdayScheduleEnabled: true,
    activeDaysOfWeek: [3, 4, 5, 6, 0], // Mi, Do, Fr, Sa, So
    happyHourEnabled: false,
    scheduleTimeZone: 'Europe/Berlin',
    ...overrides,
  } as any;
}

// В Europe/Berlin (CEST, UTC+2 летом):
const MONDAY = new Date('2026-06-22T10:00:00.000Z'); // Mo
const TUESDAY = new Date('2026-06-23T10:00:00.000Z'); // Di
const WEDNESDAY = new Date('2026-06-24T10:00:00.000Z'); // Mi

describe('isPromotionEffectivelyActive — недельное расписание', () => {
  it('1. понедельник + дни [3,4,5,6,0] → false (Mo выключен)', () => {
    expect(isPromotionEffectivelyActive(basePromo(), MONDAY)).toBe(false);
  });

  it('2. вторник выключен → false', () => {
    expect(isPromotionEffectivelyActive(basePromo(), TUESDAY)).toBe(false);
  });

  it('3. среда включена → true', () => {
    expect(isPromotionEffectivelyActive(basePromo(), WEDNESDAY)).toBe(true);
  });

  it('4. вне периода validFrom/validTo → false', () => {
    expect(
      isPromotionEffectivelyActive(basePromo(), new Date('2026-06-18T10:00:00.000Z'))
    ).toBe(false); // ещё не начался
    expect(
      isPromotionEffectivelyActive(basePromo(), new Date('2026-07-01T10:00:00.000Z'))
    ).toBe(false); // уже закончился
  });

  it('5. weekdayScheduleEnabled=false + пустые дни → true (расписание не ограничивает)', () => {
    const promo = basePromo({ weekdayScheduleEnabled: false, activeDaysOfWeek: [] });
    expect(isPromotionEffectivelyActive(promo, MONDAY)).toBe(true);
  });

  it('enabled=false → false', () => {
    expect(isPromotionEffectivelyActive(basePromo({ enabled: false }), WEDNESDAY)).toBe(false);
  });
});

describe('isPromotionEffectivelyActive — Happy Hour (окно времени в timezone)', () => {
  // окно 16:00–18:00 Europe/Berlin = 14:00–16:00 UTC летом
  const hh = (overrides = {}) =>
    basePromo({
      happyHourEnabled: true,
      activeTimeStart: '16:00',
      activeTimeEnd: '18:00',
      ...overrides,
    });

  it('6a. вне окна → false (10:00 Berlin)', () => {
    // 08:00 UTC = 10:00 Berlin (вне 16–18)
    expect(isPromotionEffectivelyActive(hh(), new Date('2026-06-24T08:00:00.000Z'))).toBe(false);
  });

  it('6b. внутри окна → true (17:00 Berlin)', () => {
    // 15:00 UTC = 17:00 Berlin (внутри 16–18)
    expect(isPromotionEffectivelyActive(hh(), new Date('2026-06-24T15:00:00.000Z'))).toBe(true);
  });
});

describe('isPromotionEffectivelyActive — timezone edge', () => {
  it('7. UTC-дата правильно определяет день недели в Europe/Berlin', () => {
    // 2026-06-23T23:30Z = вторник 23:30 UTC, но в Berlin (UTC+2) это уже среда 01:30
    const lateUtcTue = new Date('2026-06-23T23:30:00.000Z');
    // в Berlin это среда (день 3, включён) → true
    expect(isPromotionEffectivelyActive(basePromo(), lateUtcTue)).toBe(true);
  });
});
