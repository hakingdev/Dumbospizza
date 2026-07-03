import type { Metadata } from 'next';
import { getProductForSeo } from '../../../../lib/seo/catalog';
import TrackViewContent from '../../../../components/tracking/TrackViewContent';

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const product = await getProductForSeo(params.id);

  if (!product) {
    return {
      title: 'Produkt | Dumbos Pizza Bad Kissingen',
      robots: { index: false, follow: true },
    };
  }

  const rawDesc = (product.description || '').replace(/\s+/g, ' ').trim();
  const description = rawDesc
    ? rawDesc.slice(0, 160)
    : `${product.name} jetzt bei Dumbos Pizza in Bad Kissingen online bestellen — schnelle Lieferung & Abholung.`;

  const canonical = `/product/${params.id}`;
  const image = product.image && /^https?:\/\//.test(product.image) ? product.image : undefined;

  return {
    title: `${product.name} | Dumbos Pizza Bad Kissingen`,
    description,
    alternates: { canonical },
    openGraph: {
      title: `${product.name} | Dumbos Pizza`,
      description,
      url: canonical,
      type: 'website',
      ...(image ? { images: [{ url: image }] } : {}),
    },
  };
}

export default function ProductLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  return (
    <>
      {children}
      {/* Meta Pixel ViewContent — просмотр товара */}
      <TrackViewContent productId={params.id} />
    </>
  );
}
