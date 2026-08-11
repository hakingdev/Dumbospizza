import { NextRequest, NextResponse } from 'next/server';
import { restaurantLocation } from '../../../../lib/seed-products';
import { connectToDatabase } from '../../../../lib/models';
import { DeliveryZone } from '../../../../lib/models/delivery-zone.model';
import { getSetting } from '../../../../lib/settings';
import {
  selectDeliveryZone,
  matchZoneByAddress,
  roundKm,
} from '../../../../lib/delivery/zone-match';
import { geocodeAddress, type GeocodeResult } from '../../../../lib/delivery/geocode';
import { resolveRoadDistanceKm } from '../../../../lib/delivery/road-distance';
import { normalizeDetourFactor } from '../../../../lib/delivery/detour';
import { loadActiveDeliveryZones } from '../../../../lib/delivery/zones-db';

export const dynamic = 'force-dynamic';

// POST /api/delivery/check-zone — проверка адреса: геокодинг → расстояние → зона.
export async function POST(request: NextRequest) {
  try {
    const { address } = await request.json();

    if (!address || typeof address !== 'string' || !address.trim()) {
      return NextResponse.json({ success: false, error: 'Address is required' }, { status: 400 });
    }

    const fullAddress = address.includes('Germany') ? address : `${address}, Germany`;
    const zonesFromDb = await loadActiveDeliveryZones();

    const storeSettings = await getSetting<Record<string, any>>('storeSettings', {});
    const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

    // Координаты ресторана (из настроек, иначе из сидов).
    const restaurantAddress = storeSettings?.address || restaurantLocation.address;
    const restaurantCoords =
      (await geocodeAddress(restaurantAddress, googleMapsApiKey).catch(() => null)) ?? {
        lat: restaurantLocation.lat,
        lng: restaurantLocation.lng,
      };

    // Геокодинг адреса клиента.
    let coords: GeocodeResult | null = null;
    try {
      coords = await geocodeAddress(fullAddress, googleMapsApiKey);
    } catch (error) {
      console.error('Geocoding error:', error);
      coords = null;
    }
    if (!coords) {
      return NextResponse.json({
        success: false,
        canDeliver: false,
        reason: 'address_not_found',
        message: 'Adresse konnte nicht gefunden werden. Bitte überprüfen Sie Ihre Eingabe.',
      });
    }

    // Расстояние — ПО ДОРОГЕ: зоны в админке заданы километрами маршрута, а не
    // по прямой. Luftlinie кидала адрес на одну-две зоны ближе (Steinach:
    // 10.25 км по прямой против 15.89 км по дороге).
    const road = await resolveRoadDistanceKm(restaurantCoords, coords, {
      googleApiKey: storeSettings?.googleMapsApiKey || googleMapsApiKey,
      detourFactor: normalizeDetourFactor(storeSettings?.deliveryDetourFactor),
    });
    const distance = road.km;
    const distanceRounded = roundKm(distance);

    // Зоны — именованные районы Bad Kissingen: сначала матч по району/Ortsteil
    // (центр → Zentrum), и только если не нашли — радиусный fallback.
    const byName = matchZoneByAddress(
      { postcode: coords.postcode, localities: coords.localities },
      zonesFromDb as any
    );
    const match = byName
      ? { canDeliver: true as const, zone: byName }
      : selectDeliveryZone(distance, zonesFromDb as any);

    if (!match.canDeliver || !match.zone) {
      if (match.reason === 'no_zone') {
        return NextResponse.json({
          success: false,
          canDeliver: false,
          reason: 'no_zone',
          message: 'Es sind keine Lieferzonen konfiguriert.',
          distance: distanceRounded,
        });
      }
      const maxDistance = Math.max(0, ...zonesFromDb.map((z: any) => z.maxDistance || 0));
      return NextResponse.json({
        success: false,
        canDeliver: false,
        reason: 'outside_delivery_area',
        message: `Ihre Adresse liegt außerhalb unseres Liefergebiets (${distanceRounded} km > ${maxDistance} km). Abholung ist möglich.`,
        distance: distanceRounded,
        distanceMode: road.mode,
        maxDistance,
      });
    }

    const zone: any = match.zone;
    return NextResponse.json({
      success: true,
      canDeliver: true,
      zone: {
        id: String(zone.id ?? zone._id),
        name: zone.name,
        maxDistance: zone.maxDistance,
        minOrderAmount: zone.minOrderAmount,
        deliveryFee: zone.deliveryFee,
      },
      distance: distanceRounded,
      distanceMode: road.mode,
      matchedBy: byName ? 'district' : 'distance',
      coordinates: { lat: coords.lat, lng: coords.lng },
      restaurantCoordinates: { lat: restaurantCoords.lat, lng: restaurantCoords.lng },
    });
  } catch (error: any) {
    console.error('Error checking delivery zone:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// GET /api/delivery/check-zone — список активных зон + координаты ресторана.
export async function GET() {
  try {
    await connectToDatabase();
    const zones = await DeliveryZone.find({ active: true }).sort({ sortOrder: 1, name: 1 });
    const storeSettings = await getSetting<Record<string, any>>('storeSettings', {});
    // Круги на карте рисуются по прямой, а maxDistance зон — дорожные км:
    // отдаём коэффициент, чтобы карта не обещала область больше реальной.
    return NextResponse.json({
      success: true,
      zones,
      restaurantLocation,
      detourFactor: normalizeDetourFactor(storeSettings?.deliveryDetourFactor),
    });
  } catch (error: any) {
    console.error('Error fetching delivery zones:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
