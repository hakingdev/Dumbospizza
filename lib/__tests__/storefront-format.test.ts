import { describe, it, expect } from 'vitest';
import { formatEuro } from '../format-euro';
import { formatPromoDate } from '../format-date';
import { fillTemplate } from '../fill-template';
import { formatWeekdayScheduleLabel } from '../promotions/schedule';

describe('formatEuro', () => {
  it('немецкий формат с запятой', () => {
    expect(formatEuro(17.4)).toBe('17,40 €');
    expect(formatEuro(1234.5)).toBe('1.234,50 €');
    expect(formatEuro(undefined)).toBe('0,00 €');
  });
});

describe('formatPromoDate', () => {
  it('время Bad Kissingen без секунд', () => {
    // 29.12.2026 17:00 UTC = 18:00 MEZ
    expect(formatPromoDate('2026-12-29T17:00:00Z')).toBe('29.12.2026, 18:00 Uhr');
  });

  it('конец суток → только дата', () => {
    expect(formatPromoDate('2026-12-29T22:59:00Z')).toBe('29.12.2026');
  });
});

describe('fillTemplate', () => {
  it('подставляет {name}, неизвестные оставляет', () => {
    expect(fillTemplate('Bis {km} km, ab {min}', { km: 2, min: '12,00 €' })).toBe('Bis 2 km, ab 12,00 €');
    expect(fillTemplate('{x} bleibt', {})).toBe('{x} bleibt');
  });
});

describe('formatWeekdayScheduleLabel', () => {
  const label = (days: number[]) =>
    formatWeekdayScheduleLabel({ weekdayScheduleEnabled: true, activeDaysOfWeek: days });

  it('неделя с понедельника, диапазоны и исключения', () => {
    expect(label([0, 1, 2, 3, 4, 5, 6])).toBe('Täglich');
    expect(label([0, 1, 2, 4, 5, 6])).toBe('Täglich außer Mi');
    expect(label([1, 2, 3, 4, 5])).toBe('Mo–Fr');
    expect(label([6, 0])).toBe('Sa, So');
    expect(label([1, 3])).toBe('Mo, Mi');
  });
});
