import type { Metadata } from 'next';

// Клиентская страница не может экспортировать metadata — без этого layout
// вкладка показывала заголовок главной.
export const metadata: Metadata = {
  title: 'Bestellung verfolgen | Dumbos Pizza Bad Kissingen',
  description: 'Status Ihrer Bestellung bei Dumbos Pizza verfolgen.',
  robots: { index: false, follow: true },
};

export default function TrackLayout({ children }: { children: React.ReactNode }) {
  return children;
}
