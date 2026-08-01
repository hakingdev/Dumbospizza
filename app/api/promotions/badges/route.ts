import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { getEnabledPromotions } from '../../../../lib/promotions/active-promotions';
import { getProductPromotionBadges } from '../../../../lib/promotions/engine';

/**
 * Верхняя граница на случай мусорного тела запроса. Полная Speisekarte —
 * это уже сотни товаров, поэтому лимит должен быть заведомо выше каталога,
 * иначе часть карточек молча останется без бейджей.
 */
const MAX_ITEMS = 1000;

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

    if (items.length > MAX_ITEMS) {
      console.warn(
        `POST /api/promotions/badges: получено ${items.length} позиций, обрабатываю первые ${MAX_ITEMS}`
      );
    }

    const promotions = await getEnabledPromotions();
    const badges: Record<string, Array<Record<string, unknown>>> = {};

    for (const item of items.slice(0, MAX_ITEMS)) {
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
