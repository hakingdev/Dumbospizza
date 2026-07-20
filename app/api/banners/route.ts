import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { connectToDatabase } from '../../../lib/models';
import { HomepageBanner } from '../../../lib/models/banner.model';
import { authOptions, isStaff } from '../../../lib/auth';
import {
  isBannerVisible,
  normalizeActiveDays,
  ALL_WEEKDAYS,
} from '../../../lib/banners/visibility';

// Ответ зависит от текущего дня недели — кэш отдал бы вчерашнюю ленту.
export const dynamic = 'force-dynamic';

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

// GET /api/banners — публичный список видимых баннеров; ?admin=1 — все (staff)
export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    const adminList = request.nextUrl.searchParams.get('admin') === '1';

    if (adminList) {
      if (!(await isAuthorized())) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
      const all = await HomepageBanner.find({}).sort({ order: 1, createdAt: 1 });
      return NextResponse.json({ success: true, banners: all });
    }

    const now = new Date();
    const enabled = await HomepageBanner.find({ enabled: true }).sort({ order: 1, createdAt: 1 });
    const visible = enabled.filter((b: any) => isBannerVisible(b, now));

    return NextResponse.json({ success: true, banners: visible });
  } catch (error: any) {
    console.error('Error fetching banners:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST /api/banners — создать баннер (admin/staff only)
export async function POST(request: NextRequest) {
  try {
    if (!(await isAuthorized())) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectToDatabase();
    const data = await request.json();

    if (!data?.title?.trim()) {
      return NextResponse.json({ success: false, error: 'Title is required' }, { status: 400 });
    }
    if (!data?.image?.trim()) {
      return NextResponse.json({ success: false, error: 'Image is required' }, { status: 400 });
    }

    // порядок не задан — ставим в конец ленты
    let order = Number(data.order);
    if (!Number.isFinite(order)) {
      const last = await HomepageBanner.findOne().sort({ order: -1 });
      order = last ? (last.order || 0) + 1 : 0;
    }

    const banner = new HomepageBanner({
      title: data.title.trim(),
      subtitle: (data.subtitle || '').trim() || null,
      image: data.image.trim(),
      linkUrl: (data.linkUrl || '').trim() || null,
      badgeText: (data.badgeText || '').trim() || null,
      // Default aus: ein neuer Banner darf nicht ungeprüft live gehen.
      enabled: Boolean(data.enabled),
      order,
      activeDaysOfWeek: parseActiveDays(data.activeDaysOfWeek),
    });
    await banner.save();

    return NextResponse.json({ success: true, banner });
  } catch (error: any) {
    console.error('Error creating banner:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
