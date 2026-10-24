import type { Metadata } from 'next';

// Клиентская страница не может экспортировать metadata — без этого layout
// вкладка показывала заголовок главной.
export const metadata: Metadata = {
  title: 'Kasse | Dumbos Pizza Bad Kissingen',
  description: 'Bestellung abschließen bei Dumbos Pizza Bad Kissingen.',
  robots: { index: false, follow: true },
};

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
