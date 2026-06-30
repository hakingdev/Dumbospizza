import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { connectToDatabase } from '../../../../lib/models';
import { Promotion } from '../../../../lib/models/promotion.model';
import { Product } from '../../../../lib/models/product.model';
import { toPromotionPublicView } from '../../../../lib/promotions/serialize';
import {
  getOfferParticipationFallback,
  loadParticipatingProducts,
} from '../../../../lib/promotions/angebote-page-data';
import { NoTranslate } from '../../../../components/NoTranslate';

// ISR: страница акции кэшируется и ревалидируется (товары/акция меняются редко).
// Раньше был force-dynamic → каждый заход = 3 запроса к удалённой БД, отсюда долгая загрузка.
export const revalidate = 120;

type Props = { params: { slug: string } };

// React cache(): один запрос промо на рендер-проход — generateMetadata и компонент
// страницы больше НЕ дублируют запрос (раньше акция грузилась дважды).
const getPromotionBySlug = cache(async (slug: string) => {
  await connectToDatabase();
  return Promotion.findOne({ slug: slug.toLowerCase() });
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const doc = await getPromotionBySlug(params.slug);
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

export default async function AngebotDetailPage({ params }: Props) {
  const doc = await getPromotionBySlug(params.slug);
  if (!doc) notFound();
  const p = toPromotionPublicView(doc);
  const participatingProducts = await loadParticipatingProducts(p, (query) =>
    Product.find(query).select('name image basePrice').lean() as any
  );
  const participationFallback = getOfferParticipationFallback(p);

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
                  <div className="font-semibold"><NoTranslate>{prod.name}</NoTranslate></div>
                  <div className="text-primary-600 font-bold mt-1">Preis ab <NoTranslate>{prod.basePrice.toFixed(2)} €</NoTranslate></div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {participatingProducts.length === 0 && participationFallback && (
        <section className="mb-10">
          <h2 className="text-xl font-bold mb-4">Bedingung</h2>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
            <div className="font-semibold">{participationFallback.title}</div>
            <p className="mt-1 text-sm leading-6">{participationFallback.description}</p>
          </div>
        </section>
      )}

      <Link
        href="/menu"
        className="inline-flex min-h-[48px] items-center justify-center rounded-md bg-primary-600 px-8 py-3 text-center font-medium leading-tight text-white hover:bg-primary-700"
      >
        Jetzt bestellen
      </Link>
    </div>
  );
}
