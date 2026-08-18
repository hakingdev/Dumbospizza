import type { Metadata, Viewport } from 'next';
import './pos.css';
import { PosBoardProvider } from '../../components/pos/board-context';

export const metadata: Metadata = {
  title: 'Bestellannahme',
  // Терминал не должен попадать в поиск: это внутренний экран кухни.
  robots: { index: false, follow: false },
};

/**
 * Прибор — 360×720 dp. Масштабирование запрещено: случайный щипок двумя пальцами
 * на кухне уводил бы вёрстку, а вернуть её обратно жирными руками трудно.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#8a6c4c',
};

export default function PosLayout({ children }: { children: React.ReactNode }) {
  // Лента поднята сюда, чтобы сигнал о новом заказе звучал на ЛЮБОМ экране:
  // повар может стоять в меню или в стоп-листе, и именно тогда заказ и придёт.
  return (
    <div className="pos-root flex flex-col">
      <PosBoardProvider>{children}</PosBoardProvider>
    </div>
  );
}
