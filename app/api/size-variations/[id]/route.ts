import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { SizeVariation } from '../../../../lib/models/size-variation.model';
import { getServerSession } from 'next-auth';
import { authOptions, isStaff } from '../../../../lib/auth';
import {
  removeSizeVariationFromProducts,
  syncSizeVariationToProducts,
} from '../../../../lib/size-variation-sync';

async function isAuthorized() {
  const session = await getServerSession(authOptions);
  return isStaff(session);
}

// PUT /api/size-variations/[id] - обновить размер
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (!(await isAuthorized())) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectToDatabase();
    const data = await request.json();

    const update: any = {};
    if (data.name !== undefined) update.name = String(data.name).trim();
    if (data.label !== undefined) update.label = String(data.label).trim();
    if (data.order !== undefined) update.order = Number(data.order);
    if (data.active !== undefined) update.active = Boolean(data.active);

    const variation = await SizeVariation.findByIdAndUpdate(params.id, update, {
      new: true,
      runValidators: true
    });

    if (!variation) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const updatedProducts = await syncSizeVariationToProducts(variation);

    return NextResponse.json({ success: true, variation, updatedProducts });
  } catch (error: any) {
    console.error('Error updating size variation:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE /api/size-variations/[id] - удалить размер
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (!(await isAuthorized())) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectToDatabase();
    const variation = await SizeVariation.findByIdAndDelete(params.id);

    if (!variation) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const updatedProducts = await removeSizeVariationFromProducts(params.id, variation.name);

    return NextResponse.json({ success: true, updatedProducts });
  } catch (error: any) {
    console.error('Error deleting size variation:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
