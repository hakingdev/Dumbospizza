import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Liefergebiet & Lieferinfos | Dumbos Pizza Bad Kissingen',
  description:
    'Liefergebiet, Lieferzeiten und Mindestbestellwert von Dumbos Pizza. Wir liefern in Bad Kissingen, Garitz, Hausen, Arnshausen, Reiterswiesen und Winkels.',
  alternates: { canonical: '/delivery' },
  openGraph: {
    title: 'Liefergebiet & Lieferinfos | Dumbos Pizza',
    description: 'Lieferzeiten und Liefergebiet in Bad Kissingen und Umgebung.',
    url: '/delivery',
    type: 'website',
  },
};

export default function DeliveryLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
