import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { connectToDatabase } from '../../../../lib/models';
import { Promotion } from '../../../../lib/models/promotion.model';
import { Product } from '../../../../lib/models/product.model';
import { toPromotionPublicView } from '../../../../lib/promotions/serialize';

export const dynamic = 'force-dynamic';

type Props = { params: { slug: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await connectToDatabase();
  const doc = await Promotion.findOne({ slug: params.slug.toLowerCase() });
  if (!doc) return { title: 'Angebot nicht gefunden' };
  const p = toPromotionPublicView(doc);
  return {
    title: p.seoTitle || `${p.name} | Angebote | Dumbos Pizza`,
    description: p.seoDescription || p.description || undefined,
    openGraph: {
      title: p.seoTitle || p.name,
      description: p.seoDescription || p.description || undefined,
      images: p.image ? [p.image] : undefined,
    },
  };
}

async function loadParticipatingProducts(p: ReturnType<typeof toPromotionPublicView>) {
  const ids = new Set<string>();
  const products: Array<{ id: string; name: string; image?: string; basePrice: number }> = [];

  if (p.targetProductIds.length > 0) {
    const docs = await Product.find({
      _id: { $in: p.targetProductIds },
      available: true,
    })
      .select('name image basePrice')
      .lean();
    for (const doc of docs) {
      const id = String(doc._id);
      if (ids.has(id)) continue;
      ids.add(id);
      products.push({
        id,
        name: doc.name,
        image: doc.image,
        basePrice: doc.basePrice,
      });
    }
  }

  if (p.targetCategoryIds.length > 0) {
    const docs = await Product.find({
      category: { $in: p.targetCategoryIds },
      available: true,
    })
      .select('name image basePrice')
      .lean();
    for (const doc of docs) {
      const id = String(doc._id);
      if (ids.has(id)) continue;
      ids.add(id);
      products.push({
        id,
        name: doc.name,
        image: doc.image,
        basePrice: doc.basePrice,
      });
    }
  }

  return products.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export default async function AngebotDetailPage({ params }: Props) {
  await connectToDatabase();
  const doc = await Promotion.findOne({ slug: params.slug.toLowerCase() });
  if (!doc) notFound();
  const p = toPromotionPublicView(doc);
  const participatingProducts = await loadParticipatingProducts(p);

  return (
    <div className="container mx-auto px-4 py-10 max-w-4xl">
      <Link href="/angebote" className="text-sm text-primary-600 hover:underline mb-4 inline-block">
        ← Alle Angebote
      </Link>

      {p.bannerImage && (
        <div className="relative h-48 md:h-64 w-full rounded-xl overflow-hidden mb-6 bg-gray-100">
          <Image src={p.bannerImage} alt={p.name} fill className="object-cover" unoptimized />
        </div>
      )}

      <span className="block bg-primary-600 text-white text-sm font-bold px-3 py-1 rounded w-fit mb-4">
        {p.badgeText}
      </span>
      <h1 className="text-3xl font-bold mb-4">{p.name}</h1>
      {p.description && <p className="text-lg text-gray-700 mb-6">{p.description}</p>}
      {p.scheduleLabel && (
        <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-6">
          Happy Hour: {p.scheduleLabel} ({p.scheduleTimeZone || 'Europe/Berlin'})
        </p>
      )}
      <p className="text-sm text-gray-500 mb-8">
        Gültig: {new Date(p.validFrom).toLocaleString('de-DE')} –{' '}
        {new Date(p.validTo).toLocaleString('de-DE')}
      </p>

      {participatingProducts.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-bold mb-4">Teilnehmende Produkte</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {participatingProducts.map((prod) => (
              <Link
                key={prod.id}
                href={`/product/${prod.id}`}
                className="flex gap-4 border rounded-lg p-3 hover:shadow-md transition-shadow bg-white"
              >
                {prod.image ? (
                  <div className="relative h-20 w-20 shrink-0 rounded-md overflow-hidden bg-gray-100">
                    <Image src={prod.image} alt={prod.name} fill className="object-cover" unoptimized />
                  </div>
                ) : (
                  <div className="h-20 w-20 shrink-0 rounded-md bg-gray-100 flex items-center justify-center text-2xl">
                    🍕
                  </div>
                )}
                <div>
                  <div className="font-semibold">{prod.name}</div>
                  <div className="text-primary-600 font-bold mt-1">ab {prod.basePrice.toFixed(2)} €</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <Link
        href="/menu"
        className="inline-block bg-primary-600 text-white px-8 py-3 rounded-md hover:bg-primary-700 font-medium"
      >
        Jetzt bestellen
      </Link>
    </div>
  );
}
