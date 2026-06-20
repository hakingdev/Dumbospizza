import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Über uns | Dumbos Pizza Bad Kissingen',
  description:
    'Lernen Sie Dumbos Pizza in Bad Kissingen kennen — frische Zutaten, hausgemachter Teig und schnelle Lieferung. Ihre Pizzeria in der Region.',
  alternates: { canonical: '/about' },
  openGraph: {
    title: 'Über uns | Dumbos Pizza Bad Kissingen',
    description: 'Frische Zutaten, hausgemachter Teig und schnelle Lieferung.',
    url: '/about',
    type: 'website',
  },
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
