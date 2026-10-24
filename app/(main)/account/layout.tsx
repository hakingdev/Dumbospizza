import type { Metadata } from 'next';

// Клиентская страница не может экспортировать metadata — без этого layout
// вкладка показывала заголовок главной.
export const metadata: Metadata = {
  title: 'Mein Konto | Dumbos Pizza Bad Kissingen',
  description: 'Kundenkonto, Bestellungen und Treuepunkte bei Dumbos Pizza.',
  robots: { index: false, follow: true },
};

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return children;
}
