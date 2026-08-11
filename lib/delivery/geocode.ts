/**
 * Геокодинг адреса: Google Geocoding (если задан ключ) → Nominatim (OSM).
 * Вынесен из `/api/delivery/check-zone`, чтобы AI-анализ адреса
 * (`/api/delivery/analyze-address`) использовал ту же логику.
 */

import type { GeoLocationParts } from './zone-match';

export type GeocodeResult = { lat: number; lng: number } & GeoLocationParts;

export async function geocodeAddress(
  targetAddress: string,
  googleMapsApiKey?: string | null
): Promise<GeocodeResult | null> {
  if (googleMapsApiKey) {
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(targetAddress)}&key=${googleMapsApiKey}`;
    const response = await fetch(geocodeUrl);
    const data = await response.json();
    if (data.status === 'OK' && data.results.length > 0) {
      const res = data.results[0];
      const comps: any[] = res.address_components || [];
      const byType = (type: string) =>
        comps.find((c) => Array.isArray(c.types) && c.types.includes(type))?.long_name as
          | string
          | undefined;
      const localities = [
        byType('sublocality'),
        byType('sublocality_level_1'),
        byType('neighborhood'),
        byType('locality'),
        byType('administrative_area_level_3'),
      ].filter(Boolean) as string[];
      return {
        lat: res.geometry.location.lat,
        lng: res.geometry.location.lng,
        postcode: byType('postal_code'),
        localities,
      };
    }
    return null;
  }

  const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(targetAddress)}&email=info@dumbospizza.de`;
  const response = await fetch(nominatimUrl, {
    headers: {
      'User-Agent': 'DumbosPizza/1.0 (info@dumbospizza.de)',
      'Accept-Language': 'de',
    },
  });
  const results = await response.json();
  if (Array.isArray(results) && results.length > 0) {
    const a = results[0].address || {};
    const localities = [
      a.suburb,
      a.city_district,
      a.neighbourhood,
      a.quarter,
      a.hamlet,
      a.village,
      a.town,
      a.city,
      a.municipality,
    ].filter(Boolean) as string[];
    return {
      lat: Number(results[0].lat),
      lng: Number(results[0].lon),
      postcode: a.postcode,
      localities,
    };
  }
  return null;
}
