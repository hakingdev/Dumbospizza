import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DETOUR_FACTOR,
  estimateRoadDistanceKm,
  normalizeDetourFactor,
  zoneMapRadiusKm,
} from '../detour';

describe('normalizeDetourFactor', () => {
  it('вне диапазона 1…3 и мусор → дефолт', () => {
    expect(normalizeDetourFactor(undefined)).toBe(DEFAULT_DETOUR_FACTOR);
    expect(normalizeDetourFactor(0)).toBe(DEFAULT_DETOUR_FACTOR);
    expect(normalizeDetourFactor(0.5)).toBe(DEFAULT_DETOUR_FACTOR);
    expect(normalizeDetourFactor(9)).toBe(DEFAULT_DETOUR_FACTOR);
    expect(normalizeDetourFactor('abc')).toBe(DEFAULT_DETOUR_FACTOR);
  });

  it('читает число и строку с запятой', () => {
    expect(normalizeDetourFactor(1.5)).toBe(1.5);
    expect(normalizeDetourFactor('1,25')).toBe(1.25);
  });
});

describe('estimateRoadDistanceKm', () => {
  it('РЕГРЕССИЯ: Steinach — 10.25 км по прямой оценивается как > 12 км дороги', () => {
    // Иначе адрес попадал в зону «10-12 km» вместо «12 - 16 km» (реально 15.9 км).
    expect(estimateRoadDistanceKm(10.25)).toBeGreaterThan(12);
  });
});

describe('zoneMapRadiusKm', () => {
  it('дорожные км → меньший радиус по прямой', () => {
    expect(zoneMapRadiusKm(12, 1.5)).toBe(8);
    expect(zoneMapRadiusKm(12)).toBeLessThan(12);
  });

  it('нулевой/мусорный радиус не ломает карту', () => {
    expect(zoneMapRadiusKm(0)).toBe(0);
    expect(zoneMapRadiusKm(NaN)).toBe(0);
  });
});
