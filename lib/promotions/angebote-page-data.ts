import type { toPromotionPublicView } from './serialize';

type PublicPromo = ReturnType<typeof toPromotionPublicView>;

export interface ParticipatingProduct {
  id: string;
  name: string;
  image?: string;
  basePrice: number;
}

export interface OfferParticipationFallback {
  title: string;
  description: string;
}

type ProductRow = { _id: unknown; name: string; image?: string; basePrice: number };
/** Запрос товаров (инъекция для тестируемости; в проде — Product.find). */
export type FindProducts = (query: Record<string, unknown>) => Promise<ProductRow[]>;

function formatEuro(amount: number): string {
  return `${amount.toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

export function getOfferParticipationFallback(p: PublicPromo): OfferParticipationFallback | null {
  const hasThreshold =
    typeof p.minOrderAmount === 'number' && Number.isFinite(p.minOrderAmount) && p.minOrderAmount > 0;
  const thresholdSuffix = hasThreshold
    ? ` ab ${formatEuro(p.minOrderAmount as number)} Mindestbestellwert`
    : ' ab Mindestbestellwert';

  // Gratis-Artikel ab Mindestbestellwert — nicht an einzelne Produkte gebunden.
  if (p.type === 'gratis_article' && p.gratisTrigger === 'min_order') {
    return {
      title: 'Gratis-Angebot',
      description: `Dieses Angebot gilt${thresholdSuffix}. Es ist nicht an einzelne Produkte gebunden.`,
    };
  }

  // Rabatt auf die GESAMTE Bestellung (Prozent oder fester €-Betrag) — gilt für den
  // ganzen Warenkorb, deshalb gibt es keine einzelnen „teilnehmenden Produkte“.
  if ((p.type === 'percent_discount' || p.type === 'fixed_discount') && p.scope === 'order') {
    const value =
      p.type === 'percent_discount'
        ? `${Math.round(p.percentValue ?? 0)} %`
        : formatEuro(p.fixedValue ?? 0);
    return {
      title: 'Rabatt auf die Bestellung',
      description: `${value} Rabatt auf die gesamte Bestellung${
        hasThreshold ? thresholdSuffix : ''
      }. Gilt für alle Produkte im Warenkorb.`,
    };
  }

  return null;
}

/**
 * Собрать УНИКАЛЬНЫЕ id товаров акции из всех источников таргетинга:
 * новая модель Lieferando (targetItems/rewardItems по товар+размер, поэтому один
 * товар встречается несколько раз) + легаси targetProductIds.
 */
export function collectParticipatingProductIds(p: PublicPromo): string[] {
  const ids = new Set<string>();
  for (const it of [...(p.targetItems || []), ...(p.rewardItems || [])]) {
    if (it.productId) ids.add(String(it.productId));
  }
  for (const pid of p.targetProductIds || []) ids.add(String(pid));
  return Array.from(ids);
}

/**
 * Загрузить участвующие товары акции. МАКСИМУМ 2 запроса (по id и по категориям),
 * без N+1 — id заранее дедуплицируются. `findProducts` инъектируется для тестов.
 */
export async function loadParticipatingProducts(
  p: PublicPromo,
  findProducts: FindProducts
): Promise<ParticipatingProduct[]> {
  const seen = new Set<string>();
  const products: ParticipatingProduct[] = [];

  const pushDocs = (docs: ProductRow[]) => {
    for (const doc of docs) {
      const id = String(doc._id);
      if (seen.has(id)) continue;
      seen.add(id);
      products.push({ id, name: doc.name, image: doc.image, basePrice: doc.basePrice });
    }
  };

  const productIds = collectParticipatingProductIds(p);
  if (productIds.length > 0) {
    pushDocs(await findProducts({ _id: { $in: productIds }, available: true }));
  }

  if ((p.targetCategoryIds || []).length > 0) {
    pushDocs(await findProducts({ category: { $in: p.targetCategoryIds }, available: true }));
  }

  return products.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
