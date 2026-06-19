import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { DeliveryZone } from '../../../../lib/models/delivery-zone.model';
import { getServerSession } from 'next-auth';
import { authOptions, isAdmin } from '../../../../lib/auth';

async function isAuthorized() {
  const session = await getServerSession(authOptions);
  return isAdmin(session);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (!await isAuthorized()) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectToDatabase();
    const data = await request.json();

    const zone = await DeliveryZone.findByIdAndUpdate(
      params.id,
      {
        name: data.name,
        minOrderAmount: data.minOrderAmount,
        deliveryFee: data.deliveryFee,
        maxDistance: data.maxDistance,
        active: data.active,
        sortOrder: data.sortOrder
      },
      { new: true, runValidators: true }
    );

    if (!zone) {
      return NextResponse.json({ success: false, error: 'Zone not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, zone });
  } catch (error: any) {
    console.error('Error updating delivery zone:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (!await isAuthorized()) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectToDatabase();
    const zone = await DeliveryZone.findByIdAndDelete(params.id);

    if (!zone) {
      return NextResponse.json({ success: false, error: 'Zone not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting delivery zone:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

