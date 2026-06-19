import { NextRequest, NextResponse } from 'next/server';
import { restaurantLocation, deliveryZones as seedZones } from '../../../../lib/seed-products';
import { connectToDatabase } from '../../../../lib/models';
import { DeliveryZone } from '../../../../lib/models/delivery-zone.model';
import { getSetting } from '../../../../lib/settings';

// Helper function to calculate distance between two points (Haversine formula)
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return distance;
}

// POST /api/delivery/check-zone
export async function POST(request: NextRequest) {
  try {
    const { address } = await request.json();
    
    if (!address) {
      return NextResponse.json({
        success: false,
        error: 'Address is required'
      }, { status: 400 });
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
        sortOrder: index
      }));
      await DeliveryZone.insertMany(docs);
      zonesFromDb = await DeliveryZone.find({ active: true }).sort({ sortOrder: 1, name: 1 });
    }
    
    const storeSettings = await getSetting<Record<string, any>>('storeSettings', {});
    const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

    const geocodeAddress = async (targetAddress: string) => {
      if (googleMapsApiKey) {
        const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(targetAddress)}&key=${googleMapsApiKey}`;
        const response = await fetch(geocodeUrl);
        const data = await response.json();
        if (data.status === 'OK' && data.results.length > 0) {
          return {
            lat: data.results[0].geometry.location.lat,
            lng: data.results[0].geometry.location.lng
          };
        }
        return null;
      }

      const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(targetAddress)}&email=info@dumbospizza.de`;
      const response = await fetch(nominatimUrl, {
        headers: {
          'User-Agent': 'DumbosPizza/1.0 (info@dumbospizza.de)',
          'Accept-Language': 'de'
        }
      });
      const results = await response.json();
      if (Array.isArray(results) && results.length > 0) {
        return {
          lat: Number(results[0].lat),
          lng: Number(results[0].lon)
        };
      }
      return null;
    };

    let lat: number, lng: number, distance: number;

    const restaurantAddress = storeSettings?.address || restaurantLocation.address;
    let restaurantCoords = await geocodeAddress(restaurantAddress);
    if (!restaurantCoords) {
      restaurantCoords = { lat: restaurantLocation.lat, lng: restaurantLocation.lng };
    }

    try {
      const coords = await geocodeAddress(fullAddress);
      if (!coords) {
        return NextResponse.json({
          success: false,
          error: 'Address not found or invalid'
        }, { status: 400 });
      }

      lat = coords.lat;
      lng = coords.lng;
      distance = calculateDistance(
        restaurantCoords.lat,
        restaurantCoords.lng,
        lat,
        lng
      );
    } catch (error) {
      console.error('Geocoding error:', error);
      return NextResponse.json({
        success: false,
        error: 'Error geocoding address'
      }, { status: 500 });
    }
    
    // Check if address is within delivery zone (max 12 km)
    const maxDistanceValues = zonesFromDb.map((zone) => zone.maxDistance || 0);
    const MAX_DELIVERY_DISTANCE = Math.max(15, ...(maxDistanceValues.length ? maxDistanceValues : [0]));
    
    if (distance > MAX_DELIVERY_DISTANCE) {
      return NextResponse.json({
        success: false,
        canDeliver: false,
        distance: Math.round(distance * 100) / 100,
        maxDistance: MAX_DELIVERY_DISTANCE,
        message: `К сожалению, ваш адрес находится вне зоны нашей доставки (${Math.round(distance * 100) / 100} км > ${MAX_DELIVERY_DISTANCE} км). Вы можете заказать пиццу на самовывоз.`
      });
    }
    
    // Find matching delivery zone
    let matchingZone = null;
    for (const zone of zonesFromDb) {
      if (distance <= zone.maxDistance) {
        if (!matchingZone || zone.maxDistance < matchingZone.maxDistance) {
          matchingZone = zone;
        }
      }
    }
    
    if (!matchingZone && distance <= MAX_DELIVERY_DISTANCE && zonesFromDb.length > 0) {
      matchingZone = zonesFromDb.reduce((maxZone, zone) => {
        const maxA = maxZone?.maxDistance || 0;
        const maxB = zone.maxDistance || 0;
        return maxB >= maxA ? zone : maxZone;
      }, zonesFromDb[0]);
    }

    if (!matchingZone) {
      return NextResponse.json({
        success: false,
        canDeliver: false,
        distance: Math.round(distance * 100) / 100,
        message: 'Не удалось определить зону доставки'
      });
    }
    
    return NextResponse.json({
      success: true,
      canDeliver: true,
      zone: {
        id: matchingZone.id,
        name: matchingZone.name,
        minOrderAmount: matchingZone.minOrderAmount,
        deliveryFee: matchingZone.deliveryFee
      },
      distance: Math.round(distance * 100) / 100,
      coordinates: { lat, lng }
    });
  } catch (error: any) {
    console.error('Error checking delivery zone:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

// GET /api/delivery/check-zone - Get all available zones
export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    const zones = await DeliveryZone.find({ active: true }).sort({ sortOrder: 1, name: 1 });
    return NextResponse.json({
      success: true,
      zones,
      restaurantLocation
    });
  } catch (error: any) {
    console.error('Error fetching delivery zones:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

