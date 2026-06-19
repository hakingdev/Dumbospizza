import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../lib/models';
import { Promotion } from '../../../../../lib/models/promotion.model';
import { toPromotionPublicView } from '../../../../../lib/promotions/serialize';

/** GET /api/promotions/slug/[slug] — акция для SEO-страницы /angebote/[slug] */
export async function GET(
  _request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    await connectToDatabase();
    const promo = await Promotion.findOne({ slug: params.slug.toLowerCase() });
    if (!promo) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, promotion: toPromotionPublicView(promo) });
  } catch (error) {
    console.error('GET /api/promotions/slug/[slug]', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch promotion' }, { status: 500 });
  }
}
