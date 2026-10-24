import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Speisekarte | Pizza, Sushi & mehr | Dumbos Pizza Bad Kissingen',
  description:
    'Unsere komplette Speisekarte: Detroit-Style Pizza, runde Pizza, Sushi, Salate, Snacks und Getränke. Online bestellen bei Dumbos Pizza in Bad Kissingen — Lieferung & Abholung.',
  alternates: { canonical: '/menu' },
  openGraph: {
    title: 'Speisekarte | Dumbos Pizza Bad Kissingen',
    description: 'Pizza, Sushi, Salate & mehr — jetzt online bestellen.',
    url: '/menu',
    type: 'website',
  },
};

export default function MenuLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
