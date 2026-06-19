import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { Promotion } from '../../../../lib/models/promotion.model';
import { getProductPromotionBadges } from '../../../../lib/promotions/engine';

/** POST — бейджи для списка товаров (каталог / Flutter). */
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const body = await request.json();
    const channel = body.channel === 'app' ? 'app' : 'web';
    const items: Array<{ productId: string; categoryId?: string }> = Array.isArray(body.items)
      ? body.items
      : [];

    if (items.length === 0) {
      return NextResponse.json({ success: true, badges: {} });
    }

    const promotions = await Promotion.find({ enabled: true }).lean();
    const badges: Record<string, Array<Record<string, unknown>>> = {};

    for (const item of items.slice(0, 200)) {
      if (!item.productId) continue;
      badges[item.productId] = getProductPromotionBadges(
        item.productId,
        item.categoryId,
        promotions as any,
        { channel }
      ).map((b) => ({
        ...b,
        validTo: b.validTo.toISOString(),
      }));
    }

    return NextResponse.json({ success: true, badges });
  } catch (error) {
    console.error('POST /api/promotions/badges', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch badges' }, { status: 500 });
  }
}
