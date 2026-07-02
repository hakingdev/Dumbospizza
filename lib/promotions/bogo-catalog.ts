import { Product } from '../models/product.model';
import type { BogoSecondOption, BogoMode } from './types';
import { getProductDisplayPrice, getSizePrice, getValidSizes } from '../product-pricing';

type PromoRewardItem = { productId?: unknown; sizeName?: unknown };

type BogoPromoLike = {
  _id: unknown;
  type: string;
  bogoMode?: BogoMode;
  targetProductIds?: unknown[];
  targetCategoryIds?: unknown[];
  rewardItems?: PromoRewardItem[];
};

function effectivePrice(unitPrice: number, mode: BogoMode | undefined): number {
  if (mode === 'half_price') return Math.round(unitPrice * 0.5 * 100) / 100;
  return 0;
}

export async function buildBogoCatalog(
  promotions: BogoPromoLike[]
): Promise<Record<string, BogoSecondOption[]>> {
  const bogoPromos = promotions.filter((p) => p.type === 'bogo');
  if (bogoPromos.length === 0) return {};

  const categoryIds = new Set<string>();
  const productIds = new Set<string>();
  let hasOpenTargets = false;

  for (const promo of bogoPromos) {
    const rewardItems = promo.rewardItems || [];
    if (rewardItems.length > 0) {
      rewardItems.forEach((it) => it.productId && productIds.add(String(it.productId)));
      continue;
    }
    const tProductIds = (promo.targetProductIds || []).map(String);
    const tCategoryIds = (promo.targetCategoryIds || []).map(String);
    if (!tProductIds.length && !tCategoryIds.length) {
      hasOpenTargets = true;
      continue;
    }
    tProductIds.forEach((id) => productIds.add(id));
    tCategoryIds.forEach((id) => categoryIds.add(id));
  }

  const query =
    hasOpenTargets && !productIds.size && !categoryIds.size
      ? { available: true }
      : {
          available: true,
          $or: [
            ...(productIds.size ? [{ _id: { $in: Array.from(productIds) } }] : []),
            ...(categoryIds.size ? [{ category: { $in: Array.from(categoryIds) } }] : []),
          ],
        };

  const products = await Product.find(query).select('name image basePrice sizes category').lean();
  const productById = new Map(products.map((p) => [String(p._id), p]));

  const catalog: Record<string, BogoSecondOption[]> = {};
  for (const promo of bogoPromos) {
    const mode = promo.bogoMode;
    const rewardItems = promo.rewardItems || [];
    let opts: BogoSecondOption[] = [];

    if (rewardItems.length > 0) {
      // Награда из выбранных позиций (товар+размер)
      for (const it of rewardItems) {
        const p: any = productById.get(String(it.productId));
        if (!p) continue;
        const sizeName = String(it.sizeName || '').trim();
        const pricing = { basePrice: Number(p.basePrice) || 0, sizes: (p.sizes as any[]) || [] };
        if (sizeName) {
          const size = (p.sizes as any[] | undefined)?.find((s) => s?.name === sizeName);
          if (!size) continue;
          const unitPrice = getSizePrice(pricing, size);
          const sizeLabel = size.label || size.size || size.name;
          opts.push({
            id: `${String(p._id)}|${sizeName}`,
            productId: String(p._id),
            sizeName,
            name: `${p.name} — ${sizeLabel}`,
            image: p.image,
            unitPrice,
            effectivePrice: effectivePrice(unitPrice, mode),
          });
        } else {
          // весь товар: если есть размеры — раскрываем по всем размерам, иначе одна опция
          const sizes = getValidSizes(pricing);
          if (sizes.length > 0) {
            for (const size of sizes) {
              const unitPrice = getSizePrice(pricing, size);
              const sizeLabel = (size as any).label || (size as any).size || size.name;
              opts.push({
                id: `${String(p._id)}|${size.name}`,
                productId: String(p._id),
                sizeName: size.name,
                name: `${p.name} — ${sizeLabel}`,
                image: p.image,
                unitPrice,
                effectivePrice: effectivePrice(unitPrice, mode),
              });
            }
          } else {
            const unitPrice = getProductDisplayPrice(pricing);
            opts.push({
              id: String(p._id),
              productId: String(p._id),
              name: p.name as string,
              image: p.image,
              unitPrice,
              effectivePrice: effectivePrice(unitPrice, mode),
            });
          }
        }
      }
    } else {
      // Легаси: товары/категории целиком
      const targetProductIds = (promo.targetProductIds || []).map(String);
      const targetCategoryIds = (promo.targetCategoryIds || []).map(String);
      opts = products
        .filter((p) => {
          const pid = String(p._id);
          const cat = String(p.category);
          if (!targetProductIds.length && !targetCategoryIds.length) return true;
          if (targetProductIds.includes(pid)) return true;
          if (targetCategoryIds.includes(cat)) return true;
          return false;
        })
        .map((p) => {
          const unitPrice = getProductDisplayPrice({
            basePrice: Number(p.basePrice) || 0,
            sizes: (p.sizes as any[]) || [],
          });
          return {
            id: String(p._id),
            productId: String(p._id),
            name: p.name as string,
            image: p.image as string | undefined,
            unitPrice,
            effectivePrice: effectivePrice(unitPrice, promo.bogoMode),
          };
        });
    }

    // 1 позиция достаточно: награду выбирает ресторан, клиент только подтверждает.
    if (opts.length >= 1) {
      catalog[String(promo._id)] = opts;
    }
  }

  return catalog;
}
