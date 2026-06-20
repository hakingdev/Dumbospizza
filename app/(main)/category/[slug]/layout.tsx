import type { Metadata } from 'next';
import { getCategoryForSeo } from '../../../../lib/seo/catalog';

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const category = await getCategoryForSeo(params.slug);
  const canonical = `/category/${params.slug}`;

  if (!category) {
    return {
      title: 'Kategorie | Dumbos Pizza Bad Kissingen',
      robots: { index: false, follow: true },
    };
  }

  const description = `${category.name} bei Dumbos Pizza in Bad Kissingen online bestellen — große Auswahl, schnelle Lieferung & Abholung.`;

  return {
    title: `${category.name} bestellen | Dumbos Pizza Bad Kissingen`,
    description,
    alternates: { canonical },
    openGraph: {
      title: `${category.name} | Dumbos Pizza`,
      description,
      url: canonical,
      type: 'website',
    },
  };
}

export default function CategoryLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
