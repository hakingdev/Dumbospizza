import type { Metadata } from 'next';
import Link from 'next/link';
import { connectToDatabase } from '../../../lib/models';
import { Promotion } from '../../../lib/models/promotion.model';
import { toPromotionPublicView } from '../../../lib/promotions/serialize';
import { isPromotionEffectivelyActive } from '../../../lib/promotions/status';
import { SITE_URL } from '../../../lib/site-url';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Angebote | Dumbos Pizza Bad Kissingen',
  description:
    'Aktuelle Aktionen, Rabatte und Gratis-Artikel bei Dumbos Pizza. Jetzt online bestellen und sparen.',
  alternates: {
    canonical: `${SITE_URL}/angebote`,
  },
  openGraph: {
    title: 'Angebote | Dumbos Pizza',
    description: 'Aktuelle Aktionen und Rabatte — jetzt bestellen.',
    url: `${SITE_URL}/angebote`,
    type: 'website',
  },
};

export default async function AngebotePage() {
  await connectToDatabase();
  const now = new Date();
  const docs = await Promotion.find({
    enabled: true,
    showOnOffersPage: true,
    validFrom: { $lte: now },
    validTo: { $gte: now },
    $or: [{ channel: 'all' }, { channel: 'web' }],
  })
    .sort({ priority: -1 })
    .lean();

  // Дополнительно фильтруем по недельному расписанию + Happy Hour (в timezone акции),
  // т.к. Mongo-запрос проверяет только enabled/validFrom/validTo/channel.
  const promotions = docs
    .filter((p) => isPromotionEffectivelyActive(p as any, now))
    .map((p) => toPromotionPublicView(p as any));

  return (
    <div className="container mx-auto px-4 py-10 max-w-4xl">
      <h1 className="text-3xl font-bold mb-2">Angebote & Aktionen</h1>
      <p className="text-gray-600 mb-8">Alle aktuellen Rabatte — automatisch in der Bestellung angewendet.</p>

      {promotions.length === 0 ? (
        <p className="text-gray-500">Derzeit keine aktiven Angebote.</p>
      ) : (
        <div className="space-y-8">
          {promotions.map((p) => (
            <article key={p.id} className="border rounded-xl overflow-hidden shadow-sm bg-white">
              {p.bannerImage && (
                <div
                  className="h-48 bg-cover bg-center"
                  style={{ backgroundImage: `url(${p.bannerImage})` }}
                />
              )}
              <div className="p-6">
                <span className="inline-block bg-primary-600 text-white text-sm font-bold px-3 py-1 rounded mb-3">
                  {p.badgeText}
                </span>
                <h2 className="text-2xl font-bold mb-2">
                  <Link href={`/angebote/${p.slug}`} className="hover:text-primary-600">
                    {p.name}
                  </Link>
                </h2>
                {p.description && <p className="text-gray-700 mb-4">{p.description}</p>}
                <p className="text-sm text-gray-500 mb-4">
                  Gültig bis {new Date(p.validTo).toLocaleString('de-DE')}
                </p>
                <Link
                  href={`/angebote/${p.slug}`}
                  className="inline-flex min-h-[40px] items-center justify-center rounded-md bg-primary-600 px-6 py-2 text-center leading-tight text-white hover:bg-primary-700"
                >
                  Zum Angebot
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
