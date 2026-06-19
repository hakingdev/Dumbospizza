import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../lib/models';
import { Option } from '../../../lib/models/option.model';
import { getServerSession } from 'next-auth';
import { authOptions, isStaff } from '../../../lib/auth';

async function isAuthorized() {
  const session = await getServerSession(authOptions);
  return isStaff(session);
}

// GET /api/options - библиотека опций
export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    const { searchParams } = request.nextUrl;
    const active = searchParams.get('active');

    const query: any = {};
    if (active !== null) query.active = active === 'true';

    const options = await Option.find(query).sort({ name: 1 });
    return NextResponse.json({ success: true, options });
  } catch (error: any) {
    console.error('Error fetching options:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST /api/options - создать опцию
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

    const option = new Option({
      name: data.name.trim(),
      price: Number(data.price) || 0,
      active: data.active !== undefined ? Boolean(data.active) : true
    });
    await option.save();

    return NextResponse.json({ success: true, option }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating option:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
