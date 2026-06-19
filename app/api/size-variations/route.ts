import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../lib/models';
import { SizeVariation } from '../../../lib/models/size-variation.model';
import { getServerSession } from 'next-auth';
import { authOptions, isStaff } from '../../../lib/auth';

async function isAuthorized() {
  const session = await getServerSession(authOptions);
  return isStaff(session);
}

// GET /api/size-variations - список размеров из библиотеки
export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();

    const { searchParams } = request.nextUrl;
    const active = searchParams.get('active');

    const query: any = {};
    if (active !== null) {
      query.active = active === 'true';
    }

    const variations = await SizeVariation.find(query).sort({ order: 1, name: 1 });
    return NextResponse.json({ success: true, variations });
  } catch (error: any) {
    console.error('Error fetching size variations:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST /api/size-variations - создать размер (admin/staff only)
export async function POST(request: NextRequest) {
  try {
    if (!(await isAuthorized())) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectToDatabase();
    const data = await request.json();

    if (!data?.name?.trim()) {
      return NextResponse.json({ success: false, error: 'Name is required' }, { status: 400 });
    }

    // если порядок не задан — ставим в конец
    if (data.order === undefined || data.order === null) {
      const last = await SizeVariation.findOne().sort({ order: -1 });
      data.order = last ? (last.order || 0) + 1 : 0;
    }

    const variation = new SizeVariation({
      name: data.name.trim(),
      label: (data.label || '').trim(),
      order: data.order,
      active: data.active !== undefined ? Boolean(data.active) : true
    });
    await variation.save();

    return NextResponse.json({ success: true, variation }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating size variation:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
