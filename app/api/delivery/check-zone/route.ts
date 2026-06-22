import { NextRequest, NextResponse } from 'next/server';
import { restaurantLocation, deliveryZones as seedZones } from '../../../../lib/seed-products';
import { connectToDatabase } from '../../../../lib/models';
import { DeliveryZone } from '../../../../lib/models/delivery-zone.model';
import { getSetting } from '../../../../lib/settings';
import {
  haversineDistanceKm,
  selectDeliveryZone,
  matchZoneByAddress,
  roundKm,
  type GeoLocationParts,
} from '../../../../lib/delivery/zone-match';

export const dynamic = 'force-dynamic';

// POST /api/delivery/check-zone — проверка адреса: геокодинг → расстояние → зона.
export async function POST(request: NextRequest) {
  try {
    const { address } = await request.json();

    if (!address || typeof address !== 'string' || !address.trim()) {
      return NextResponse.json({ success: false, error: 'Address is required' }, { status: 400 });
    }

    const fullAddress = address.includes('Germany') ? address : `${address}, Germany`;
    await connectToDatabase();

    let zonesFromDb = await DeliveryZone.find({ active: true }).sort({ sortOrder: 1, name: 1 });
    if (zonesFromDb.length === 0 && seedZones.length > 0) {
      const docs = seedZones.map((zone, index) => ({
        name: zone.name,
        minOrderAmount: zone.minOrderAmount,
        deliveryFee: zone.deliveryFee || 0,
        maxDistance: zone.maxDistance || 0,
        active: true,
        sortOrder: index,
      }));
      await DeliveryZone.insertMany(docs);
      zonesFromDb = await DeliveryZone.find({ active: true }).sort({ sortOrder: 1, name: 1 });
    }

    const storeSettings = await getSetting<Record<string, any>>('storeSettings', {});
    const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

    type GeoResult = { lat: number; lng: number } & GeoLocationParts;

    const geocodeAddress = async (targetAddress: string): Promise<GeoResult | null> => {
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
    };

    // Координаты ресторана (из настроек, иначе из сидов).
    const restaurantAddress = storeSettings?.address || restaurantLocation.address;
    let restaurantCoords = await geocodeAddress(restaurantAddress).catch(() => null);
    if (!restaurantCoords) {
      restaurantCoords = { lat: restaurantLocation.lat, lng: restaurantLocation.lng };
    }

    // Геокодинг адреса клиента.
    let coords: GeoResult | null = null;
    try {
      coords = await geocodeAddress(fullAddress);
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

    const distance = haversineDistanceKm(restaurantCoords, coords);
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
    return NextResponse.json({ success: true, zones, restaurantLocation });
  } catch (error: any) {
    console.error('Error fetching delivery zones:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
