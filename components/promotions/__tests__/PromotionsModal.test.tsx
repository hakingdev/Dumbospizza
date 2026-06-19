import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Баг: кнопка «Zum Angebot» в модалке «Aktuelle Angebote» не срабатывала с первого
 * клика (модалка висела без обратной связи, пока грузилась динамическая страница).
 * Фикс: по клику сразу закрываем модалку + трекинг; навигация по Link с loading.tsx.
 */

const h = vi.hoisted(() => ({
  getActivePromotions: vi.fn(),
  trackPromotionEvent: vi.fn(),
}));

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
// next/link без AppRouter-контекста падает — мокаем обычным <a>, onClick сохраняем.
vi.mock('next/link', () => ({
  default: ({ href, children, onClick, ...rest }: any) => (
    <a href={typeof href === 'string' ? href : '#'} onClick={onClick} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../../../lib/api-client', () => ({
  getActivePromotions: (...a: any[]) => h.getActivePromotions(...a),
  trackPromotionEvent: (...a: any[]) => h.trackPromotionEvent(...a),
}));
vi.mock('../../../lib/contexts/CartContext', () => ({
  useCart: () => ({
    state: { promotionCalculation: null, selectedFreeGifts: {} },
  }),
}));

const promo = (over: Record<string, unknown> = {}) => ({
  id: 'promo1',
  name: 'Halben Preis',
  slug: 'halben-preis',
  badgeText: '50 %',
  description: 'Zweite Pizza zum halben Preis',
  ...over,
});

// Модуль с флагом «показано за загрузку» — сбрасываем перед каждым тестом.
const renderModal = async () => {
  vi.resetModules();
  const { default: PromotionsModal } = await import('../PromotionsModal');
  return render(<PromotionsModal />);
};

beforeEach(() => {
  h.getActivePromotions.mockReset();
  h.trackPromotionEvent.mockReset().mockResolvedValue(undefined);
});

describe('PromotionsModal — «Zum Angebot»', () => {
  it('модалка открывается и показывает Angebot (fast response)', async () => {
    h.getActivePromotions.mockResolvedValue({ success: true, promotions: [promo()] });
    await renderModal();
    expect(await screen.findByText('Aktuelle Angebote')).toBeInTheDocument();
    expect(screen.getByText('Halben Preis')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Zum Angebot' });
    expect(link).toHaveAttribute('href', '/angebote/halben-preis');
  });

  it('первый клик сразу выполняет действие: трекинг 1 раз + модалка закрывается', async () => {
    const user = userEvent.setup();
    h.getActivePromotions.mockResolvedValue({ success: true, promotions: [promo()] });
    await renderModal();
    await screen.findByText('Aktuelle Angebote');

    h.trackPromotionEvent.mockClear(); // отбрасываем modal_open-события
    await user.click(screen.getByRole('link', { name: 'Zum Angebot' }));

    // handler вызван РОВНО один раз на один клик
    expect(h.trackPromotionEvent).toHaveBeenCalledTimes(1);
    expect(h.trackPromotionEvent).toHaveBeenCalledWith('promo1', 'click');
    // модалка закрылась сразу — второй клик не нужен
    expect(screen.queryByText('Aktuelle Angebote')).not.toBeInTheDocument();
  });

  it('slow response: модалка не показывается, пока данные не загрузились', async () => {
    let resolve!: (v: any) => void;
    h.getActivePromotions.mockReturnValue(new Promise((r) => (resolve = r)));
    await renderModal();

    // пока pending — модалки нет (нет «висящей» кнопки в неопределённом состоянии)
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('Aktuelle Angebote')).not.toBeInTheDocument();

    resolve({ success: true, promotions: [promo()] });
    expect(await screen.findByText('Aktuelle Angebote')).toBeInTheDocument();
  });

  it('failed response: модалка не открывается, без падения', async () => {
    h.getActivePromotions.mockRejectedValue(new Error('API down'));
    await renderModal();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('Aktuelle Angebote')).not.toBeInTheDocument();
  });

  it('empty list: модалка не открывается', async () => {
    h.getActivePromotions.mockResolvedValue({ success: true, promotions: [] });
    await renderModal();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('Aktuelle Angebote')).not.toBeInTheDocument();
  });
});
