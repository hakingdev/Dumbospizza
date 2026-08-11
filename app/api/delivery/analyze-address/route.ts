import { NextRequest, NextResponse } from 'next/server';
import { restaurantLocation } from '../../../../lib/seed-products';
import { getSetting } from '../../../../lib/settings';
import {
  selectDeliveryZone,
  matchZoneByAddress,
  normalizeName,
  formatDeliveryFee,
  roundKm,
} from '../../../../lib/delivery/zone-match';
import { geocodeAddress } from '../../../../lib/delivery/geocode';
import { resolveRoadDistanceKm, type RoadDistanceResult } from '../../../../lib/delivery/road-distance';
import { normalizeDetourFactor } from '../../../../lib/delivery/detour';
import { loadActiveDeliveryZones } from '../../../../lib/delivery/zones-db';
import { analyzeDeliveryAddress } from '../../../../lib/delivery/ai-zone-analysis';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function zonePayload(zone: any) {
  return {
    id: String(zone.id ?? zone._id),
    name: zone.name,
    maxDistance: zone.maxDistance,
    minOrderAmount: zone.minOrderAmount,
    deliveryFee: zone.deliveryFee,
  };
}

function successMessage(zone: any): string {
  return `Lieferung möglich – ${zone.name}. Liefergebühr: ${formatDeliveryFee(zone.deliveryFee || 0)}, Mindestbestellwert: ${(zone.minOrderAmount || 0).toFixed(2)} €.`;
}

// POST /api/delivery/analyze-address — AI-проверка адреса: Claude решает, входит
// ли адрес в одну из зон из админки; при сбое AI — геометрический fallback
// (та же логика, что и /api/delivery/check-zone).
export async function POST(request: NextRequest) {
  try {
    const { address } = await request.json();

    if (!address || typeof address !== 'string' || !address.trim()) {
      return NextResponse.json({ success: false, error: 'Address is required' }, { status: 400 });
    }

    const fullAddress = address.includes('Germany') ? address : `${address}, Germany`;

    const zones = await loadActiveDeliveryZones();
    if (zones.length === 0) {
      return NextResponse.json({
        success: false,
        canDeliver: false,
        reason: 'no_zone',
        message: 'Es sind keine Lieferzonen konfiguriert.',
      });
    }

    const storeSettings = await getSetting<Record<string, any>>('storeSettings', {});
    const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    const restaurantAddress = storeSettings?.address || restaurantLocation.address;

    // Геоданные — best effort: они повышают точность AI-анализа и нужны для
    // fallback, но их отсутствие анализ не блокирует.
    const [restaurantGeo, coords] = await Promise.all([
      geocodeAddress(restaurantAddress, googleMapsApiKey).catch(() => null),
      geocodeAddress(fullAddress, googleMapsApiKey).catch(() => null),
    ]);
    const restaurantCoords = restaurantGeo ?? {
      lat: restaurantLocation.lat,
      lng: restaurantLocation.lng,
    };

    let road: RoadDistanceResult | null = null;
    if (coords) {
      road = await resolveRoadDistanceKm(restaurantCoords, coords, {
        googleApiKey: storeSettings?.googleMapsApiKey || googleMapsApiKey,
        detourFactor: normalizeDetourFactor(storeSettings?.deliveryDetourFactor),
      }).catch(() => null);
    }
    const distanceRounded = road ? roundKm(road.km) : undefined;

    // --- AI-анализ ---
    try {
      const verdict = await analyzeDeliveryAddress({
        address: fullAddress,
        restaurantAddress,
        zones: zones.map((z: any) => ({
          name: z.name,
          maxDistance: z.maxDistance || 0,
          deliveryFee: z.deliveryFee || 0,
          minOrderAmount: z.minOrderAmount || 0,
        })),
        geo: coords
          ? {
              postcode: coords.postcode,
              localities: coords.localities,
              roadDistanceKm: distanceRounded,
              distanceMode: road?.mode,
            }
          : null,
      });

      if (!verdict.canDeliver) {
        return NextResponse.json({
          success: false,
          canDeliver: false,
          reason: 'outside_delivery_area',
          message:
            verdict.message ||
            'Leider liegt Ihre Adresse außerhalb unseres Liefergebiets. Abholung ist möglich.',
          distance: distanceRounded,
          matchedBy: 'ai',
        });
      }

      const zone = verdict.zoneName
        ? zones.find((z: any) => normalizeName(z.name) === normalizeName(verdict.zoneName))
        : null;
      if (zone) {
        return NextResponse.json({
          success: true,
          canDeliver: true,
          zone: zonePayload(zone),
          distance: distanceRounded,
          distanceMode: road?.mode,
          matchedBy: 'ai',
          message: successMessage(zone),
          coordinates: coords ? { lat: coords.lat, lng: coords.lng } : undefined,
          restaurantCoordinates: { lat: restaurantCoords.lat, lng: restaurantCoords.lng },
        });
      }
      // canDeliver=true, но имя зоны не совпало со списком → геометрический fallback.
      console.error('AI zone name did not match any zone:', verdict.zoneName);
    } catch (error) {
      console.error('AI zone analysis failed, falling back to geometry:', error);
    }

    // --- Геометрический fallback (логика check-zone) ---
    if (!coords) {
      return NextResponse.json({
        success: false,
        canDeliver: false,
        reason: 'address_not_found',
        message: 'Adresse konnte nicht gefunden werden. Bitte überprüfen Sie Ihre Eingabe.',
      });
    }

    const byName = matchZoneByAddress(
      { postcode: coords.postcode, localities: coords.localities },
      zones as any
    );
    const distance = road?.km ?? 0;
    const match = byName
      ? { canDeliver: true as const, zone: byName }
      : selectDeliveryZone(distance, zones as any);

    if (!match.canDeliver || !match.zone) {
      const maxDistance = Math.max(0, ...zones.map((z: any) => z.maxDistance || 0));
      return NextResponse.json({
        success: false,
        canDeliver: false,
        reason: 'outside_delivery_area',
        message: `Ihre Adresse liegt außerhalb unseres Liefergebiets (${distanceRounded} km > ${maxDistance} km). Abholung ist möglich.`,
        distance: distanceRounded,
        distanceMode: road?.mode,
        maxDistance,
      });
    }

    return NextResponse.json({
      success: true,
      canDeliver: true,
      zone: zonePayload(match.zone),
      distance: distanceRounded,
      distanceMode: road?.mode,
      matchedBy: byName ? 'district' : 'distance',
      message: successMessage(match.zone),
      coordinates: { lat: coords.lat, lng: coords.lng },
      restaurantCoordinates: { lat: restaurantCoords.lat, lng: restaurantCoords.lng },
    });
  } catch (error: any) {
    console.error('Error analyzing delivery address:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
