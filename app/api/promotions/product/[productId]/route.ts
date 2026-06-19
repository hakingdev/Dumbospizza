import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../lib/models';
import { Promotion } from '../../../../../lib/models/promotion.model';
import { getProductPromotionBadges } from '../../../../../lib/promotions/engine';

/** GET /api/promotions/product/[productId] — бейджи акций для карточки товара */
export async function GET(
  request: NextRequest,
  { params }: { params: { productId: string } }
) {
  try {
    await connectToDatabase();
    const categoryId = request.nextUrl.searchParams.get('categoryId') || undefined;
    const channel = request.nextUrl.searchParams.get('channel') === 'app' ? 'app' : 'web';
    const promotions = await Promotion.find({ enabled: true }).lean();
    const badges = getProductPromotionBadges(
      params.productId,
      categoryId,
      promotions as any,
      { channel }
    ).map((b) => ({ ...b, validTo: b.validTo.toISOString() }));
    return NextResponse.json({ success: true, badges });
  } catch (error) {
    console.error('GET /api/promotions/product/[productId]', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch badges' }, { status: 500 });
  }
}
