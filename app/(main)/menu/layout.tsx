import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Speisekarte | Pizza, Pasta & mehr | Dumbos Pizza Bad Kissingen',
  description:
    'Unsere komplette Speisekarte: Pizza, Pasta, Salate, Snacks und Getränke. Online bestellen bei Dumbos Pizza in Bad Kissingen — schnelle Lieferung & Abholung.',
  alternates: { canonical: '/menu' },
  openGraph: {
    title: 'Speisekarte | Dumbos Pizza Bad Kissingen',
    description: 'Pizza, Pasta, Salate & mehr — jetzt online bestellen.',
    url: '/menu',
    type: 'website',
  },
};

export default function MenuLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
