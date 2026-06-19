import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../lib/models';
import { DeliveryZone } from '../../../lib/models/delivery-zone.model';
import { getServerSession } from 'next-auth';
import { authOptions, isAdmin } from '../../../lib/auth';
import { deliveryZones as seedZones } from '../../../lib/seed-products';

async function isAuthorized() {
  const session = await getServerSession(authOptions);
  return isAdmin(session);
}

export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();

    const searchParams = request.nextUrl.searchParams;
    const includeAll = searchParams.get('all') === '1';
    if (includeAll && !await isAuthorized()) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const query = includeAll ? {} : { active: true };

    let zones = await DeliveryZone.find(query).sort({ sortOrder: 1, name: 1 });
    if (zones.length === 0 && seedZones.length > 0) {
      const docs = seedZones.map((zone, index) => ({
        name: zone.name,
        minOrderAmount: zone.minOrderAmount,
        deliveryFee: zone.deliveryFee || 0,
        maxDistance: zone.maxDistance || 0,
        active: true,
        sortOrder: index
      }));
      await DeliveryZone.insertMany(docs);
      zones = await DeliveryZone.find(query).sort({ sortOrder: 1, name: 1 });
    }

    return NextResponse.json({ success: true, zones });
  } catch (error: any) {
    console.error('Error fetching delivery zones:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!await isAuthorized()) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectToDatabase();
    const data = await request.json();

    const zone = new DeliveryZone({
      name: data.name,
      minOrderAmount: data.minOrderAmount ?? 0,
      deliveryFee: data.deliveryFee ?? 0,
      maxDistance: data.maxDistance ?? 0,
      active: data.active ?? true,
      sortOrder: data.sortOrder ?? 0
    });

    await zone.save();
    return NextResponse.json({ success: true, zone }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating delivery zone:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

