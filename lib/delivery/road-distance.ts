/**
 * Дорожное расстояние (Fahrstrecke) ресторан → адрес клиента.
 *
 * ЗАЧЕМ: зоны в админке ресторан задаёт «по дороге» («12 - 16 km» — это столько,
 * сколько реально едет курьер), а подбор зоны считал Luftlinie (Haversine).
 * Bergstraße 2, 97708 Steinach: по прямой 10.25 км, по дороге 15.9 км — адрес
 * падал в зону «10-12 km» (min 37 €, 5 €) вместо «12 - 16 km» (min 42 €, 6 €).
 *
 * Провайдеры по приоритету:
 *   1) Google Distance Matrix — если задан ключ (настройки или env);
 *   2) OSRM (open-source роутер OpenStreetMap) — без ключа;
 *   3) fallback: Luftlinie × коэффициент объезда (см. DEFAULT_DETOUR_FACTOR).
 */

import { haversineDistanceKm, type LatLng } from './zone-match';
import { estimateRoadDistanceKm } from './detour';

/** Чем посчитано расстояние: реальный маршрут или оценка из Luftlinie. */
export type DistanceMode = 'road' | 'estimated';

export interface RoadDistanceResult {
  km: number;
  mode: DistanceMode;
  /** Какой провайдер ответил ('google' | 'osrm' | 'haversine'). */
  provider: 'google' | 'osrm' | 'haversine';
}

const REQUEST_TIMEOUT_MS = 6000;

/** Кэш маршрутов в памяти инстанса: адрес проверяют по несколько раз подряд. */
const CACHE_TTL_MS = 30 * 60 * 1000;
const routeCache = new Map<string, { km: number; provider: 'google' | 'osrm'; at: number }>();

function cacheKey(from: LatLng, to: LatLng): string {
  // 4 знака ≈ 11 м — достаточно точно и хорошо склеивает повторные проверки.
  const r = (v: number) => v.toFixed(4);
  return `${r(from.lat)},${r(from.lng)}->${r(to.lat)},${r(to.lng)}`;
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<any> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** Google Distance Matrix (driving), км. null — если не ответил. */
async function fetchGoogleRoadDistanceKm(
  from: LatLng,
  to: LatLng,
  apiKey: string
): Promise<number | null> {
  const url =
    `https://maps.googleapis.com/maps/api/distancematrix/json` +
    `?origins=${from.lat},${from.lng}&destinations=${to.lat},${to.lng}` +
    `&mode=driving&units=metric&key=${encodeURIComponent(apiKey)}`;
  const data = await fetchJson(url);
  if (data?.status !== 'OK') return null;
  const element = data?.rows?.[0]?.elements?.[0];
  if (element?.status !== 'OK') return null;
  const meters = Number(element?.distance?.value);
  return Number.isFinite(meters) && meters > 0 ? meters / 1000 : null;
}

/** OSRM (driving), км. null — если не ответил. */
async function fetchOsrmRoadDistanceKm(from: LatLng, to: LatLng): Promise<number | null> {
  const base = (process.env.OSRM_BASE_URL || 'https://router.project-osrm.org').replace(/\/$/, '');
  const url =
    `${base}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?overview=false&alternatives=false`;
  const data = await fetchJson(url, { 'User-Agent': 'DumbosPizza/1.0 (info@dumbospizza.de)' });
  if (data?.code !== 'Ok') return null;
  const meters = Number(data?.routes?.[0]?.distance);
  return Number.isFinite(meters) && meters > 0 ? meters / 1000 : null;
}

/**
 * Расстояние по дороге. Никогда не бросает: при любой ошибке провайдера
 * возвращает оценку из Luftlinie (mode: 'estimated'), чтобы проверка адреса
 * не падала целиком из-за недоступного роутера.
 */
export async function resolveRoadDistanceKm(
  from: LatLng,
  to: LatLng,
  options: { googleApiKey?: string | null; detourFactor?: number } = {}
): Promise<RoadDistanceResult> {
  const airKm = haversineDistanceKm(from, to);

  const key = cacheKey(from, to);
  const cached = routeCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { km: cached.km, mode: 'road', provider: cached.provider };
  }

  const providers: Array<{ name: 'google' | 'osrm'; run: () => Promise<number | null> }> = [];
  const googleApiKey = options.googleApiKey?.trim();
  if (googleApiKey) {
    providers.push({ name: 'google', run: () => fetchGoogleRoadDistanceKm(from, to, googleApiKey) });
  }
  providers.push({ name: 'osrm', run: () => fetchOsrmRoadDistanceKm(from, to) });

  for (const provider of providers) {
    try {
      const km = await provider.run();
      // Маршрут короче прямой физически невозможен — значит, ответ мусорный.
      if (km != null && km >= airKm * 0.95) {
        routeCache.set(key, { km, provider: provider.name, at: Date.now() });
        return { km, mode: 'road', provider: provider.name };
      }
    } catch (error) {
      console.error(`Road distance provider ${provider.name} failed:`, error);
    }
  }

  return {
    km: estimateRoadDistanceKm(airKm, options.detourFactor),
    mode: 'estimated',
    provider: 'haversine',
  };
}
