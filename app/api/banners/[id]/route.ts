import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { connectToDatabase } from '../../../../lib/models';
import { HomepageBanner } from '../../../../lib/models/banner.model';
import { authOptions, isStaff } from '../../../../lib/auth';
import { normalizeActiveDays, ALL_WEEKDAYS } from '../../../../lib/banners/visibility';

async function isAuthorized() {
  const session = await getServerSession(authOptions);
  return isStaff(session);
}

/**
 * Дни показа из формы. Ничего не выбрано → все семь: так в БД лежит ровно то,
 * что админка потом покажет галочками, без скрытого «пусто = всегда».
 */
function parseActiveDays(value: unknown): number[] {
  const days = normalizeActiveDays(value);
  return days.length ? days : ALL_WEEKDAYS;
}

// PUT /api/banners/[id] — обновить баннер
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!(await isAuthorized())) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectToDatabase();
    const data = await request.json();

    const update: any = {};
    if (data.title !== undefined) update.title = String(data.title).trim();
    if (data.subtitle !== undefined) update.subtitle = String(data.subtitle).trim() || null;
    if (data.image !== undefined) update.image = String(data.image).trim();
    if (data.linkUrl !== undefined) update.linkUrl = String(data.linkUrl).trim() || null;
    if (data.badgeText !== undefined) update.badgeText = String(data.badgeText).trim() || null;
    if (data.enabled !== undefined) update.enabled = Boolean(data.enabled);
    if (data.order !== undefined) update.order = Number(data.order);
    if (data.activeDaysOfWeek !== undefined) {
      update.activeDaysOfWeek = parseActiveDays(data.activeDaysOfWeek);
    }

    if (update.title !== undefined && !update.title) {
      return NextResponse.json({ success: false, error: 'Title is required' }, { status: 400 });
    }
    if (update.image !== undefined && !update.image) {
      return NextResponse.json({ success: false, error: 'Image is required' }, { status: 400 });
    }

    const banner = await HomepageBanner.findByIdAndUpdate(params.id, update, { new: true });
    if (!banner) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, banner });
  } catch (error: any) {
    console.error('Error updating banner:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE /api/banners/[id] — удалить баннер
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!(await isAuthorized())) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectToDatabase();
    const banner = await HomepageBanner.findByIdAndDelete(params.id);

    if (!banner) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting banner:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
