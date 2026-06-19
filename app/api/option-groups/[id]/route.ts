import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { OptionGroup } from '../../../../lib/models/option-group.model';
import '../../../../lib/models/option.model';
import { getServerSession } from 'next-auth';
import { authOptions, isStaff } from '../../../../lib/auth';

async function isAuthorized() {
  const session = await getServerSession(authOptions);
  return isStaff(session);
}

// PUT /api/option-groups/[id]
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
    if (data.optionIds !== undefined) update.optionIds = Array.isArray(data.optionIds) ? data.optionIds : [];
    if (data.required !== undefined) update.required = Boolean(data.required);
    if (data.minSelect !== undefined) update.minSelect = Number(data.minSelect) || 0;
    if (data.maxSelect !== undefined) update.maxSelect = Number(data.maxSelect) || 0;
    if (data.active !== undefined) update.active = Boolean(data.active);
    if (data.order !== undefined) update.order = Number(data.order);

    const group = await OptionGroup.findByIdAndUpdate(params.id, update, {
      new: true,
      runValidators: true
    }).populate('optionIds');

    if (!group) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, group });
  } catch (error: any) {
    console.error('Error updating option group:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE /api/option-groups/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (!(await isAuthorized())) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    await connectToDatabase();
    const group = await OptionGroup.findByIdAndDelete(params.id);
    if (!group) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting option group:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
