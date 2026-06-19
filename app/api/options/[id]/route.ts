import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { Option } from '../../../../lib/models/option.model';
import { getServerSession } from 'next-auth';
import { authOptions, isStaff } from '../../../../lib/auth';

async function isAuthorized() {
  const session = await getServerSession(authOptions);
  return isStaff(session);
}

// PUT /api/options/[id]
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
    if (data.price !== undefined) update.price = Number(data.price) || 0;
    if (data.active !== undefined) update.active = Boolean(data.active);

    const option = await Option.findByIdAndUpdate(params.id, update, {
      new: true,
      runValidators: true
    });
    if (!option) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, option });
  } catch (error: any) {
    console.error('Error updating option:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE /api/options/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (!(await isAuthorized())) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    await connectToDatabase();
    const option = await Option.findByIdAndDelete(params.id);
    if (!option) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting option:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
