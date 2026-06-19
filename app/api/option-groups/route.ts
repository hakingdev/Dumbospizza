import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../lib/models';
import { OptionGroup } from '../../../lib/models/option-group.model';
// гарантируем регистрацию модели Option для populate
import '../../../lib/models/option.model';
import { getServerSession } from 'next-auth';
import { authOptions, isStaff } from '../../../lib/auth';

async function isAuthorized() {
  const session = await getServerSession(authOptions);
  return isStaff(session);
}

// GET /api/option-groups - группы опций (с populate опций)
export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    const { searchParams } = request.nextUrl;
    const active = searchParams.get('active');

    const query: any = {};
    if (active !== null) query.active = active === 'true';

    const groups = await OptionGroup.find(query)
      .sort({ order: 1, name: 1 })
      .populate('optionIds');

    return NextResponse.json({ success: true, groups });
  } catch (error: any) {
    console.error('Error fetching option groups:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST /api/option-groups - создать группу
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

    if (data.order === undefined || data.order === null) {
      const last = await OptionGroup.findOne().sort({ order: -1 });
      data.order = last ? (last.order || 0) + 1 : 0;
    }

    const group = new OptionGroup({
      name: data.name.trim(),
      optionIds: Array.isArray(data.optionIds) ? data.optionIds : [],
      required: Boolean(data.required),
      minSelect: Number(data.minSelect) || 0,
      maxSelect: Number(data.maxSelect) || 0,
      active: data.active !== undefined ? Boolean(data.active) : true,
      order: data.order
    });
    await group.save();
    await group.populate('optionIds');

    return NextResponse.json({ success: true, group }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating option group:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
