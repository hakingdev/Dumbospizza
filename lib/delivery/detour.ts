/**
 * Пересчёт «прямая ↔ дорога». Отдельный модуль без fetch, чтобы клиентские
 * компоненты (карта зон) могли импортировать его, не таща за собой роутеры.
 */

/**
 * Коэффициент объезда (Umwegfaktor) — во сколько раз дорога длиннее прямой.
 * 1.3–1.4 — типично для местности вокруг Bad Kissingen (Steinach: 15.89/10.25 =
 * 1.55, Garitz: ~1.2). Нужен там, где реального маршрута нет: fallback подбора
 * зоны и радиусы кругов на карте.
 */
export const DEFAULT_DETOUR_FACTOR = 1.35;

/** Санитайзер коэффициента из настроек (пустое/мусор/вне 1…3 → дефолт). */
export function normalizeDetourFactor(raw: unknown): number {
  const n = typeof raw === 'string' ? parseFloat(raw.replace(',', '.')) : Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 3) return DEFAULT_DETOUR_FACTOR;
  return n;
}

/** Оценка дороги из Luftlinie (fallback, когда роутер недоступен). */
export function estimateRoadDistanceKm(
  airKm: number,
  factor: number = DEFAULT_DETOUR_FACTOR
): number {
  return airKm * normalizeDetourFactor(factor);
}

/**
 * Радиус круга на карте для зоны, заданной ДОРОЖНЫМИ километрами.
 * Круг рисуется по прямой, поэтому «12 км по дороге» ≈ 12 / 1.35 ≈ 8.9 км
 * по прямой — иначе картинка обещает область заметно больше реальной.
 */
export function zoneMapRadiusKm(
  roadKm: number,
  factor: number = DEFAULT_DETOUR_FACTOR
): number {
  const km = Number(roadKm);
  if (!Number.isFinite(km) || km <= 0) return 0;
  return km / normalizeDetourFactor(factor);
}
