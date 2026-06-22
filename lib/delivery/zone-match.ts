/**
 * Чистая логика подбора зоны доставки по расстоянию. Единый источник истины для
 * `/api/delivery/check-zone` и тестов (геокодинг и БД — снаружи).
 */

export interface DeliveryZoneLike {
  id?: string;
  _id?: string;
  name: string;
  minOrderAmount: number;
  deliveryFee: number;
  maxDistance: number;
}

export type ZoneMatchReason = 'outside_delivery_area' | 'no_zone';

export interface ZoneMatchResult {
  canDeliver: boolean;
  zone?: DeliveryZoneLike;
  reason?: ZoneMatchReason;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** Расстояние между двумя точками (Haversine), км. */
export function haversineDistanceKm(a: LatLng, b: LatLng): number {
  const R = 6371; // радиус Земли, км
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Округление расстояния до 2 знаков (для ответа API/UI). */
export function roundKm(distance: number): number {
  return Math.round(distance * 100) / 100;
}

/** Стоимость доставки для UI: 0 → "Kostenlos", иначе "3.00 €". */
export function formatDeliveryFee(fee: number): string {
  if (!fee || fee <= 0) return 'Kostenlos';
  return `${fee.toFixed(2)} €`;
}

/**
 * Порядок отрисовки кругов на карте: от большего радиуса к меньшему,
 * чтобы маленькие зоны были видны поверх больших. Не мутирует вход.
 */
export function sortZonesForMap<T extends { maxDistance: number }>(zones: T[]): T[] {
  return [...zones].sort((a, b) => (b.maxDistance || 0) - (a.maxDistance || 0));
}

/** Порядок в списке-панели: от меньшего радиуса к большему (1 km, 2 km, 4 km …). */
export function sortZonesForList<T extends { maxDistance: number }>(zones: T[]): T[] {
  return [...zones].sort((a, b) => (a.maxDistance || 0) - (b.maxDistance || 0));
}

/**
 * Подбор зоны: наименьшая зона, чей `maxDistance >= distance`.
 * Если зон нет → `no_zone`. Если адрес дальше всех зон → `outside_delivery_area`.
 */
export function selectDeliveryZone(
  distance: number,
  zones: DeliveryZoneLike[]
): ZoneMatchResult {
  if (!zones || zones.length === 0) {
    return { canDeliver: false, reason: 'no_zone' };
  }
  const qualifying = zones.filter((z) => (z.maxDistance || 0) >= distance);
  if (qualifying.length === 0) {
    return { canDeliver: false, reason: 'outside_delivery_area' };
  }
  const zone = qualifying.reduce((best, z) =>
    (z.maxDistance || 0) < (best.maxDistance || 0) ? z : best
  );
  return { canDeliver: true, zone };
}

// --- Сопоставление по району/PLZ (для именованных зон, а не концентрических колец) ---

/** Нормализация названия: lower, умляуты, только буквы/цифры/пробелы. */
export function normalizeName(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * «Район» зоны = название без ведущего города (`Bad Kissingen Garitz` → `garitz`).
 * Для отдельных населённых пунктов (`Euerdorf`) остаётся как есть.
 */
export function zoneDistrictToken(name: string): string {
  const n = normalizeName(name);
  const stripped = n.replace(/^bad kissingen\s*/, '').trim();
  return stripped || n; // у самого «Bad Kissingen» (центр) токен пустой → вернём полное
}

export interface GeoLocationParts {
  postcode?: string;
  /** Токены локации из геокодера: suburb, city_district, neighbourhood, village, town, city … */
  localities: string[];
}

/**
 * Подбор зоны по адресу (район/Ortsteil, затем центр города как default).
 * Возвращает зону или null (тогда вызывающий код падает на радиусный fallback).
 */
export function matchZoneByAddress(
  parts: GeoLocationParts,
  zones: DeliveryZoneLike[]
): DeliveryZoneLike | null {
  if (!zones || zones.length === 0) return null;
  const localTokens = (parts.localities || []).map(normalizeName).filter(Boolean);
  if (localTokens.length === 0) return null;

  // 1) Прямое совпадение по названию района/Ortsteil.
  for (const zone of zones) {
    const token = zoneDistrictToken(zone.name);
    if (!token) continue;
    if (localTokens.some((l) => l === token || l.includes(token) || token.includes(l))) {
      return zone;
    }
  }

  // 2) Адрес в самом городе (Bad Kissingen) без конкретного Ortsteil → зона «…Zentrum».
  const isBaseCity = localTokens.some((l) => l.includes('bad kissingen'));
  if (isBaseCity) {
    const zentrum = zones.find((z) => normalizeName(z.name).includes('zentrum'));
    if (zentrum) return zentrum;
  }

  return null;
}
