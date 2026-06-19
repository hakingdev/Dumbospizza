import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { Promotion } from '../../../../lib/models/promotion.model';
import { Product } from '../../../../lib/models/product.model';
import { calculatePromotions } from '../../../../lib/promotions/engine';
import { enrichFreeGiftOffers, applySelectedFreeGifts } from '../../../../lib/promotions/gifts';
import { buildBogoCatalog } from '../../../../lib/promotions/bogo-catalog';
import { resolvePromotionCustomerContext } from '../../../../lib/promotions/audience';
import type { PromotionCartItem, PromotionChannel } from '../../../../lib/promotions/types';

const EMPTY_CALCULATION = {
  subtotal: 0,
  productDiscountTotal: 0,
  orderDiscountTotal: 0,
  promotionDiscountTotal: 0,
  lineAdjustments: [],
  freeGifts: [],
  freeGiftOffers: [],
  bogoSecondOffers: [],
  bogoSecondItems: [],
  appliedPromotions: [],
};

/** POST — серверный расчёт акций для корзины (сайт + приложение). */
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const body = await request.json();
    const items: PromotionCartItem[] = Array.isArray(body.items) ? body.items : [];
    const channel: PromotionChannel = body.channel === 'app' ? 'app' : 'web';
    const promoCode =
      typeof body.promoCode === 'string' ? body.promoCode.trim().toUpperCase() : undefined;
    const phoneNumber =
      typeof body.phoneNumber === 'string' ? body.phoneNumber.trim() : undefined;
    const parseSelections = (arr: unknown) =>
      Array.isArray(arr)
        ? arr.filter(
            (s: unknown) =>
              s &&
              typeof s === 'object' &&
              typeof (s as { promotionId?: unknown }).promotionId === 'string' &&
              typeof (s as { productId?: unknown }).productId === 'string'
          )
        : [];

    const selectedBogoSecond = parseSelections(body.selectedBogoSecond);
    const selectedFreeGifts = parseSelections(body.selectedFreeGifts);

    if (items.length === 0) {
      return NextResponse.json({
        success: true,
        calculation: EMPTY_CALCULATION,
      });
    }

    for (const item of items) {
      if (!item.productId || !item.name || !item.quantity || item.unitPrice == null) {
        return NextResponse.json(
          { success: false, error: 'Each item needs productId, name, quantity, unitPrice' },
          { status: 400 }
        );
      }
    }

    const promotions = await Promotion.find({ enabled: true }).lean();
    const customerContext = await resolvePromotionCustomerContext(phoneNumber);
    const bogoCatalog = await buildBogoCatalog(promotions as any);

    let calculation = calculatePromotions(items, promotions as any, {
      channel,
      promoCode,
      customerContext,
      selectedBogoSecond,
      bogoCatalog,
    });

    const giftProductIds = new Set<string>();
    for (const offer of calculation.freeGiftOffers || []) {
      for (const opt of offer.options) {
        giftProductIds.add(opt.productId);
      }
    }

    if (giftProductIds.size > 0) {
      const products = await Product.find({ _id: { $in: Array.from(giftProductIds) } })
        .select('name image')
        .lean();
      const productsById = new Map(
        products.map((p) => [
          String(p._id),
          { name: p.name as string, image: p.image as string | undefined },
        ])
      );
      calculation = enrichFreeGiftOffers(calculation, productsById);
    }
    if (selectedFreeGifts.length > 0) {
      calculation = applySelectedFreeGifts(calculation, selectedFreeGifts);
    }

    return NextResponse.json({ success: true, calculation });
  } catch (error) {
    console.error('POST /api/promotions/calculate', error);
    return NextResponse.json({ success: false, error: 'Calculation failed' }, { status: 500 });
  }
}
