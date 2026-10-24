import type { Metadata } from 'next';

// Клиентская страница не может экспортировать metadata — без этого layout
// вкладка показывала заголовок главной.
export const metadata: Metadata = {
  title: 'Warenkorb | Dumbos Pizza Bad Kissingen',
  description: 'Ihr Warenkorb bei Dumbos Pizza Bad Kissingen.',
  robots: { index: false, follow: true },
};

export default function CartLayout({ children }: { children: React.ReactNode }) {
  return children;
}
