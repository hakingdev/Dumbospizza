// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  emptyWeeklySchedule,
  evaluateOrderHours,
  formatScheduleLines,
  getOrderHoursState,
  normalizeWeeklySchedule,
  resolveWeeklySchedule,
  scheduleBounds,
  toOpeningHoursSpecification,
  uniformDailyRange,
  validateWeeklySchedule,
  type WeeklySchedule,
} from '../opening-schedule';

/**
 * Недельный график приёма: по дню — несколько интервалов, пустой день —
 * выходной. Октябрь 2026 до 25-го — летнее время, Берлин = UTC+2.
 * 19.10.2026 — понедельник.
 */

const schedule: WeeklySchedule = {
  mon: [
    { start: '10:00', end: '14:00' },
    { start: '17:00', end: '21:00' },
  ],
  tue: [],
  wed: [{ start: '17:00', end: '22:00' }],
  thu: [{ start: '17:00', end: '22:00' }],
  fri: [{ start: '17:00', end: '22:00' }],
  sat: [{ start: '17:00', end: '00:00' }],
  sun: [{ start: '12:00', end: '21:00' }],
};

const settings = {
  ordersWeeklySchedule: schedule,
  ordersTimeZone: 'Europe/Berlin',
  ordersClosedMessageBeforeOpen: 'Wir öffnen um {time}',
  ordersClosedMessageAfterClose: 'Geschlossen. Wieder da: {day} ab {time}',
};
const defaults = { beforeOpen: 'Мы откроем в {time}', afterClose: 'Мы закрыты' };

/** Берлинское время понедельника 19.10.2026 (+offset дней) → Date. */
const berlin = (dayOffset: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 9, 19 + dayOffset, h - 2, m));
};

describe('getOrderHoursState', () => {
  it('внутри утреннего интервала — открыто', () => {
    const state = getOrderHoursState(schedule, 'Europe/Berlin', berlin(0, '12:00'));
    expect(state.open).toBe(true);
    expect(state.today).toBe('mon');
    expect(state.current).toEqual({ start: '10:00', end: '14:00' });
  });

  it('перерыв между интервалами — откроемся сегодня в 17:00', () => {
    const state = getOrderHoursState(schedule, 'Europe/Berlin', berlin(0, '15:00'));
    expect(state.open).toBe(false);
    expect(state.nextOpening).toEqual({ daysAhead: 0, day: 'mon', time: '17:00' });
  });

  it('конец интервала не включается', () => {
    expect(getOrderHoursState(schedule, 'Europe/Berlin', berlin(0, '14:00')).open).toBe(false);
    expect(getOrderHoursState(schedule, 'Europe/Berlin', berlin(0, '13:59')).open).toBe(true);
  });

  it('после последней смены перескакивает выходной вторник на среду', () => {
    const state = getOrderHoursState(schedule, 'Europe/Berlin', berlin(0, '21:30'));
    expect(state.nextOpening).toEqual({ daysAhead: 2, day: 'wed', time: '17:00' });
  });

  it('конец 00:00 — до полуночи', () => {
    expect(getOrderHoursState(schedule, 'Europe/Berlin', berlin(5, '23:45')).open).toBe(true);
  });

  it('день недели — по Берлину, а не по UTC сервера', () => {
    // 00:30 понедельника в Берлине = 22:30 воскресенья UTC.
    const state = getOrderHoursState(schedule, 'Europe/Berlin', berlin(0, '00:30'));
    expect(state.today).toBe('mon');
    expect(state.nextOpening).toEqual({ daysAhead: 0, day: 'mon', time: '10:00' });
  });

  it('пустой график — закрыто без следующего открытия', () => {
    const state = getOrderHoursState(emptyWeeklySchedule(), 'Europe/Berlin', berlin(0, '12:00'));
    expect(state.open).toBe(false);
    expect(state.nextOpening).toBeNull();
  });
});

describe('evaluateOrderHours', () => {
  it('открыто — без сообщения', () => {
    expect(evaluateOrderHours(settings, berlin(0, '18:00'), defaults)).toMatchObject({
      accepting: true,
      message: null,
    });
  });

  it('перерыв — текст «до открытия» с {time}', () => {
    expect(evaluateOrderHours(settings, berlin(0, '15:00'), defaults)).toMatchObject({
      accepting: false,
      message: 'Wir öffnen um 17:00',
      opensAtTime: '17:00',
    });
  });

  it('после закрытия — {day}/{time} ближайшего рабочего дня', () => {
    expect(evaluateOrderHours(settings, berlin(0, '21:30'), defaults).message).toBe(
      'Geschlossen. Wieder da: Mittwoch ab 17:00'
    );
    // Воскресенье 18.10 (25.10 уже зимнее время — смещение +2 там не годится).
    expect(evaluateOrderHours(settings, berlin(-1, '21:30'), defaults).message).toBe(
      'Geschlossen. Wieder da: morgen ab 10:00'
    );
  });

  it('выходной день целиком — текст «после закрытия»', () => {
    const verdict = evaluateOrderHours(settings, berlin(1, '18:00'), defaults);
    expect(verdict.accepting).toBe(false);
    expect(verdict.message).toBe('Geschlossen. Wieder da: morgen ab 17:00');
  });

  it('пустые тексты в настройках — дефолты вызывающего', () => {
    const bare = { ordersWeeklySchedule: schedule };
    expect(evaluateOrderHours(bare, berlin(0, '15:00'), defaults).message).toBe('Мы откроем в 17:00');
    expect(evaluateOrderHours(bare, berlin(0, '22:00'), defaults).message).toBe('Мы закрыты');
  });

  it('без графика действует старая пара ordersStartHour/ordersEndHour на все дни', () => {
    const legacy = { ordersStartHour: '17:00', ordersEndHour: '22:00' };
    expect(evaluateOrderHours(legacy, berlin(1, '18:00'), defaults).accepting).toBe(true);
    expect(evaluateOrderHours(legacy, berlin(1, '22:00'), defaults).accepting).toBe(false);
    expect(evaluateOrderHours(legacy, berlin(1, '16:00'), defaults).message).toBe('Мы откроем в 17:00');
  });
});

describe('validateWeeklySchedule', () => {
  it('нормализует время и сортирует интервалы', () => {
    const { schedule: out, errors } = validateWeeklySchedule({
      mon: [
        { start: '17:00', end: '21:00' },
        { start: '9:30', end: '14:00' },
      ],
    });
    expect(errors).toEqual([]);
    expect(out?.mon).toEqual([
      { start: '09:30', end: '14:00' },
      { start: '17:00', end: '21:00' },
    ]);
    expect(out?.tue).toEqual([]);
  });

  it('ловит пересечение, обратный интервал и пустое время', () => {
    const { schedule: out, errors } = validateWeeklySchedule({
      mon: [
        { start: '10:00', end: '15:00' },
        { start: '14:00', end: '18:00' },
      ],
      tue: [{ start: '22:00', end: '02:00' }],
      wed: [{ start: '', end: '21:00' }],
    });
    expect(out).toBeNull();
    expect(errors.map((e) => [e.day, e.index])).toEqual([
      ['mon', 1],
      ['tue', 0],
      ['wed', 0],
    ]);
  });

  it('конец 00:00 допустим', () => {
    expect(validateWeeklySchedule({ sat: [{ start: '17:00', end: '00:00' }] }).errors).toEqual([]);
  });
});

describe('normalize/resolve', () => {
  it('битый график из БД → фолбэк на старые поля', () => {
    expect(normalizeWeeklySchedule('мусор')).toBeNull();
    expect(normalizeWeeklySchedule({ foo: 1 })).toBeNull();
    const resolved = resolveWeeklySchedule({
      ordersWeeklySchedule: { mon: [{ start: '20:00', end: '10:00' }] },
      ordersStartHour: '17:00',
      ordersEndHour: '22:00',
    });
    expect(uniformDailyRange(resolved)).toEqual({ start: '17:00', end: '22:00' });
  });
});

describe('показ', () => {
  it('uniformDailyRange — только когда все дни одинаковы и по одному интервалу', () => {
    expect(uniformDailyRange(schedule)).toBeNull();
    expect(uniformDailyRange(resolveWeeklySchedule({ ordersStartHour: '17:00', ordersEndHour: '22:00' }))).toEqual({
      start: '17:00',
      end: '22:00',
    });
  });

  it('formatScheduleLines склеивает одинаковые дни', () => {
    expect(formatScheduleLines(schedule, { locale: 'de', closedLabel: 'Ruhetag' })).toEqual([
      'Mo 10:00–14:00, 17:00–21:00',
      'Di Ruhetag',
      'Mi–Fr 17:00–22:00',
      'Sa 17:00–00:00',
      'So 12:00–21:00',
    ]);
    const weekend: WeeklySchedule = {
      ...schedule,
      mon: schedule.wed,
      tue: schedule.wed,
      sat: [{ start: '12:00', end: '22:00' }],
      sun: [{ start: '12:00', end: '22:00' }],
    };
    expect(formatScheduleLines(weekend, { locale: 'ru', closedLabel: 'выходной' })).toEqual([
      'Пн–Пт 17:00–22:00',
      'Сб, Вс 12:00–22:00',
    ]);
  });

  it('JSON-LD: пары открытие/закрытие, полночь = 23:59', () => {
    const spec = toOpeningHoursSpecification(schedule);
    expect(spec).toContainEqual({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday'],
      opens: '10:00',
      closes: '14:00',
    });
    expect(spec).toContainEqual({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Wednesday', 'Thursday', 'Friday'],
      opens: '17:00',
      closes: '22:00',
    });
    expect(spec).toContainEqual({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Saturday'],
      opens: '17:00',
      closes: '23:59',
    });
    expect(spec.some((s) => s.dayOfWeek.includes('Tuesday'))).toBe(false);
  });

  it('scheduleBounds — самое раннее начало и самый поздний конец', () => {
    expect(scheduleBounds(schedule)).toEqual({ start: '10:00', end: '00:00' });
    expect(scheduleBounds(emptyWeeklySchedule())).toBeNull();
  });
});
