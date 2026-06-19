import { Promotion } from '../models/promotion.model';
import { calculatePromotions } from './engine';
import { buildBogoCatalog } from './bogo-catalog';
import { resolvePromotionCustomerContext } from './audience';
import type { PromotionCalculationResult, PromotionCartItem } from './types';
import { normalizeObjectId } from '../normalize-id';

export function cartItemsToPromotionItems(items: Array<{
  id?: string;
  productId?: string;
  product?: string;
  categoryId?: string;
  name: string;
  quantity: number;
  price: number;
  size?: { name?: string } | null;
}>): PromotionCartItem[] {
  return items.map((item) => ({
    productId: String(item.productId || item.id || item.product),
    categoryId: normalizeObjectId(item.categoryId),
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.price,
    sizeName: item.size?.name || '',
  }));
}

export async function calculateOrderPromotions(
  items: Parameters<typeof cartItemsToPromotionItems>[0],
  options: {
    channel?: 'web' | 'app';
    promoCode?: string;
    phoneNumber?: string;
    selectedBogoSecond?: Array<{ promotionId: string; productId: string }>;
  } = {}
): Promise<PromotionCalculationResult> {
  const promotions = await Promotion.find({ enabled: true }).lean();
  const customerContext = await resolvePromotionCustomerContext(options.phoneNumber);
  const bogoCatalog = await buildBogoCatalog(promotions as any);
  return calculatePromotions(cartItemsToPromotionItems(items), promotions as any, {
    channel: options.channel || 'web',
    promoCode: options.promoCode,
    customerContext,
    selectedBogoSecond: options.selectedBogoSecond,
    bogoCatalog,
  });
}

export async function recordPromotionOrderAnalytics(
  applied: Array<{ promotionId: string; savedAmount?: number }>,
  orderTotal: number
): Promise<void> {
  await Promise.all(
    applied.map((p) =>
      Promotion.findByIdAndUpdate(p.promotionId, {
        $inc: {
          orderCount: 1,
          usageCount: 1,
          revenueTotal: p.savedAmount && p.savedAmount > 0 ? p.savedAmount : orderTotal,
        },
      })
    )
  );
}
