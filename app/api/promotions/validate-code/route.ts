import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { Promotion } from '../../../../lib/models/promotion.model';
import { isPromotionActive } from '../../../../lib/promotions/status';

export const dynamic = 'force-dynamic';

/** GET /api/promotions/validate-code?code=XXX — проверка promo-кода акции (слой Promotion). */
export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    const code = request.nextUrl.searchParams.get('code')?.trim().toUpperCase();
    if (!code) {
      return NextResponse.json({ success: false, error: 'Code required' }, { status: 400 });
    }

    const promo = await Promotion.findOne({ promoCode: code, enabled: true });
    if (!promo || !isPromotionActive(promo)) {
      return NextResponse.json({ success: false, error: 'Invalid or expired promotion code' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      promotionCode: {
        code: promo.promoCode,
        name: promo.name,
        type: 'promotion',
        promotionId: String(promo._id),
      },
    });
  } catch (error) {
    console.error('GET /api/promotions/validate-code', error);
    return NextResponse.json({ success: false, error: 'Validation failed' }, { status: 500 });
  }
}
