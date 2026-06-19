import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { connectToDatabase } from '../../../lib/models';
import { Promotion } from '../../../lib/models/promotion.model';
import { authOptions, isStaff } from '../../../lib/auth';
import { slugifyPromotionName, getPromotionLifecycle, isPromotionEffectivelyActive } from '../../../lib/promotions/status';
import { toPromotionAdminView, toPromotionPublicView } from '../../../lib/promotions/serialize';
import {
  formatPromotionSaveError,
  sanitizePromotionPayload,
} from '../../../lib/promotions/sanitize-payload';
import type { PromotionType } from '../../../lib/promotions/types';

/** GET — публичный список активных акций или admin-список. POST — создать акцию (admin). */
export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    const { searchParams } = request.nextUrl;
    const type = searchParams.get('type') as PromotionType | null;
    const lifecycle = searchParams.get('lifecycle');
    const productId = searchParams.get('productId');
    const modalOnly =
      searchParams.get('modal') === '1' || searchParams.get('modal') === 'true';
    const adminList = searchParams.get('admin') === '1';

    const session = await getServerSession(authOptions);
    const isAdminUser = session && isStaff(session);

    if (adminList) {
      if (!isAdminUser) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
      const query: Record<string, unknown> = {};
      if (type) query.type = type;
      const promos = await Promotion.find(query).sort({ priority: -1, validFrom: -1 }).lean();
      const withLifecycle = promos.map((p) => ({
        ...toPromotionAdminView(p as any),
        lifecycle: getPromotionLifecycle(p as any),
      }));
      const filtered =
        lifecycle && lifecycle !== 'all'
          ? withLifecycle.filter((p) => p.lifecycle === lifecycle)
          : withLifecycle;
      return NextResponse.json({ success: true, promotions: filtered });
    }

    const now = new Date();
    let promos = await Promotion.find({
      enabled: true,
      validFrom: { $lte: now },
      validTo: { $gte: now },
      ...(type ? { type } : {}),
      ...(modalOnly ? { showInModal: true } : {}),
    })
      .sort({ priority: -1, validFrom: -1 })
      .lean();

    if (modalOnly || !adminList) {
      promos = promos.filter((p) => isPromotionEffectivelyActive(p as any, now));
    }

    let publicList = promos.map((p) => toPromotionPublicView(p as any));

    if (productId) {
      publicList = publicList.filter(
        (p) =>
          p.targetProductIds.length === 0 ||
          p.targetProductIds.includes(productId)
      );
    }

    return NextResponse.json({ success: true, promotions: publicList });
  } catch (error) {
    console.error('GET /api/promotions', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch promotions' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session || !isStaff(session)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    if (!body.name?.trim() || !body.type || !body.validFrom || !body.validTo) {
      return NextResponse.json(
        { success: false, error: 'name, type, validFrom and validTo are required' },
        { status: 400 }
      );
    }

    let slug = (body.slug || slugifyPromotionName(body.name)).trim().toLowerCase();
    if (!slug) slug = `angebot-${Date.now()}`;
    const existingSlug = await Promotion.findOne({ slug });
    if (existingSlug) slug = `${slug}-${Date.now()}`;

    const payload = sanitizePromotionPayload(body);

    const promo = await Promotion.create({
      ...payload,
      slug,
      name: body.name.trim(),
      validFrom: new Date(body.validFrom),
      validTo: new Date(body.validTo),
      targetProductIds: payload.targetProductIds || [],
      targetCategoryIds: payload.targetCategoryIds || [],
    });

    return NextResponse.json({
      success: true,
      promotion: toPromotionAdminView(promo),
    });
  } catch (error) {
    console.error('POST /api/promotions', error);
    const { message, status } = formatPromotionSaveError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
