import { Product } from '../models/product.model';
import { getValidSizes } from '../product-pricing';
import { hydrateSizeVariationStates } from '../size-variation-sync';
import { normalizedSizeName } from '../size-variation-state';
import { getGiftItems, giftOptionId } from './gifts';

type GiftPromoLike = {
  type: string;
  giftProductId?: unknown;
  giftProductIds?: unknown[];
  giftItems?: Array<{ productId?: unknown; sizeName?: unknown }>;
};

/**
 * Schlüssel der TATSÄCHLICH lieferbaren Gratis-Positionen — `productId` bzw.
 * `productId|sizeName`, im selben Format wie giftOptionId().
 *
 * Die Engine kennt nur die Angebots-Konfiguration, nicht den Produktbestand:
 * ein im Admin abgeschaltetes Produkt (available=false) oder eine abgeschaltete
 * Größe (active=false) blieb bisher als Gratis-Artikel im Warenkorb. Dieser
 * Katalog ist das DB-Gegenstück zu buildBogoCatalog und filtert genau das weg.
 */
export async function buildGiftCatalog(
  promotions: GiftPromoLike[]
): Promise<Set<string>> {
  const gratisPromos = promotions.filter((p) => p.type === 'gratis_article');
  if (gratisPromos.length === 0) return new Set();

  const productIds = new Set<string>();
  for (const promo of gratisPromos) {
    for (const item of getGiftItems(promo)) productIds.add(item.productId);
  }
  if (productIds.size === 0) return new Set();

  const products = await Product.find({
    _id: { $in: Array.from(productIds) },
    available: true,
  })
    .select('basePrice sizes')
    .lean();
  // Größen-Status kommt aus der Bibliothek — ohne Hydration greift ein dort
  // abgeschalteter Größenvariant nicht auf die eingebetteten Produktgrößen durch.
  await hydrateSizeVariationStates(products as any[]);

  const productById = new Map(products.map((p: any) => [String(p._id), p]));

  const catalog = new Set<string>();
  for (const promo of gratisPromos) {
    for (const item of getGiftItems(promo)) {
      const product = productById.get(item.productId);
      // Produkt gelöscht oder im Admin abgeschaltet → kein Gratis-Artikel.
      if (!product) continue;

      const pricing = { basePrice: Number(product.basePrice) || 0, sizes: product.sizes || [] };
      const activeSizes = getValidSizes(pricing);

      if (item.sizeName) {
        // Größenvergleich über normalizedSizeName, nicht === (siehe size-variation-state).
        const wanted = normalizedSizeName(item.sizeName);
        if (!activeSizes.some((s) => normalizedSizeName(s.name) === wanted)) continue;
      } else if ((product.sizes || []).length > 0 && activeSizes.length === 0) {
        // Geschenk „ganzes Produkt“, aber jede Größe ist abgeschaltet.
        continue;
      }

      catalog.add(giftOptionId(item.productId, item.sizeName));
    }
  }

  return catalog;
}
