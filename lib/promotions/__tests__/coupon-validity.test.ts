import { describe, it, expect } from 'vitest';
import {
  isCouponCurrentlyValid,
  normalizeCouponCode,
  resolveCouponValidTo,
} from '../coupon-validity';

const TEAM = (over: Record<string, any> = {}) => ({
  code: 'TEAM',
  active: true,
  validFrom: new Date('2026-06-01T00:00:00.000Z'),
  validTo: new Date('2026-06-30T21:59:59.999Z'), // конец дня Berlin для 30.06 (CEST)
  usageLimit: null,
  usageCount: 0,
  minOrderAmount: null,
  ...over,
});

describe('normalizeCouponCode', () => {
  it('trim + uppercase: team / TEAM / " Team " → TEAM', () => {
    expect(normalizeCouponCode('team')).toBe('TEAM');
    expect(normalizeCouponCode('TEAM')).toBe('TEAM');
    expect(normalizeCouponCode('  Team ')).toBe('TEAM');
    expect(normalizeCouponCode(undefined)).toBe('');
  });
});

describe('isCouponCurrentlyValid — даты', () => {
  it('AC #1: валидный купон в середине периода', () => {
    const r = isCouponCurrentlyValid(TEAM(), new Date('2026-06-22T12:00:00.000Z'));
    expect(r.valid).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('AC #2: date-only validTo (2026-06-30) валиден до КОНЦА дня в Europe/Berlin', () => {
    const c = TEAM({ validTo: new Date('2026-06-30') }); // полночь UTC = date-only
    // 22:00 Berlin 30.06 (20:00 UTC) — ещё валиден
    expect(isCouponCurrentlyValid(c, new Date('2026-06-30T20:00:00.000Z')).valid).toBe(true);
    // 00:30 Berlin 01.07 (22:30 UTC 30.06) — уже истёк
    const late = isCouponCurrentlyValid(c, new Date('2026-06-30T22:30:00.000Z'));
    expect(late.valid).toBe(false);
    expect(late.reason).toBe('expired');
  });

  it('resolveCouponValidTo: date-only → 23:59:59.999 Berlin (= 21:59:59.999Z летом)', () => {
    const end = resolveCouponValidTo(new Date('2026-06-30'));
    expect(end.toISOString()).toBe('2026-06-30T21:59:59.999Z');
  });

  it('resolveCouponValidTo: явное время не трогаем', () => {
    const explicit = new Date('2026-06-30T18:00:00.000Z');
    expect(resolveCouponValidTo(explicit).toISOString()).toBe('2026-06-30T18:00:00.000Z');
  });

  it('expired: now после validTo', () => {
    const r = isCouponCurrentlyValid(TEAM(), new Date('2026-07-02T12:00:00.000Z'));
    expect(r).toEqual({ valid: false, reason: 'expired' });
  });

  it('not_started: now до validFrom (date-only → начало дня Berlin)', () => {
    const c = TEAM({ validFrom: new Date('2026-07-01'), validTo: new Date('2026-07-31') });
    const r = isCouponCurrentlyValid(c, new Date('2026-06-30T12:00:00.000Z'));
    expect(r).toEqual({ valid: false, reason: 'not_started' });
  });
});

describe('isCouponCurrentlyValid — статусы', () => {
  const now = new Date('2026-06-22T12:00:00.000Z');

  it('not_found: купон null', () => {
    expect(isCouponCurrentlyValid(null, now)).toEqual({ valid: false, reason: 'not_found' });
  });

  it('inactive: active=false', () => {
    expect(isCouponCurrentlyValid(TEAM({ active: false }), now)).toEqual({
      valid: false,
      reason: 'inactive',
    });
  });

  it('usage_limit: usageCount >= usageLimit', () => {
    expect(isCouponCurrentlyValid(TEAM({ usageLimit: 5, usageCount: 5 }), now)).toEqual({
      valid: false,
      reason: 'usage_limit',
    });
  });

  it('min_order: orderAmount < minOrderAmount', () => {
    expect(isCouponCurrentlyValid(TEAM({ minOrderAmount: 30 }), now, 20)).toEqual({
      valid: false,
      reason: 'min_order',
    });
    // достаточная сумма → валиден
    expect(isCouponCurrentlyValid(TEAM({ minOrderAmount: 30 }), now, 35).valid).toBe(true);
    // без orderAmount min_order не проверяется
    expect(isCouponCurrentlyValid(TEAM({ minOrderAmount: 30 }), now).valid).toBe(true);
  });
});
