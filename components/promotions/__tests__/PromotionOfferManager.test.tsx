import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Регрессия: модалка «вторая пицца за полцены» НЕ должна переоткрываться сразу
 * после выбора пиццы.
 *
 * Реальная причина бага: при 2+ подходящих пиццах движок выдаёт награду на каждую
 * единицу, поэтому ПОСЛЕ выбора одной награды пересчёт корзины возвращает НОВЫЙ
 * расчёт, в котором оффер всё ещё присутствует → авто-открытие срабатывает снова.
 * Тест воспроизводит именно это: после выбора приходит новый расчёт с тем же
 * оффером, и попап не должен открыться повторно (пока корзина не изменилась).
 */

const h = vi.hoisted(() => ({
  cart: null as any,
  setSelectedBogoSecond: null as any,
  setSelectedFreeGift: null as any,
}));

vi.mock('next/navigation', () => ({ usePathname: () => '/menu' }));
vi.mock('../../../lib/contexts/LanguageContext', () => ({ useLanguage: () => ({ language: 'de' }) }));
vi.mock('../../../lib/i18n', () => ({
  loadTranslation: async () => ({ t: (_k: string, fb?: string) => fb || _k }),
}));
vi.mock('../../../lib/contexts/CartContext', () => ({ useCart: () => h.cart }));

import PromotionOfferManager from '../PromotionOfferManager';

const makeBogoOffer = (promotionId = 'promo1') => ({
  promotionId,
  promotionName: 'Halben Preis',
  bogoMode: 'half_price' as const,
  label: '2. Artikel zum halben Preis',
  options: [
    { id: 'p1', productId: 'p1', name: 'Bayern Pizza', unitPrice: 10, effectivePrice: 5 },
    { id: 'p2', productId: 'p2', name: 'Salami Pizza', unitPrice: 10, effectivePrice: 5 },
  ],
});

// КАЖДЫЙ вызов — НОВАЯ ссылка расчёта (как ответ API при пересчёте).
const makeCalc = (bogoOffers: any[]) =>
  ({ bogoSecondOffers: bogoOffers, freeGiftOffers: [], appliedPromotions: [] }) as any;

const setCart = (promotionCalculation: any, items?: any[]) => {
  h.cart = {
    state: {
      items: items || [
        { id: 'p1', productId: 'p1', name: 'Bayern', size: { name: '' }, quantity: 2, price: 10 },
      ],
      promotionCalculation,
      couponCode: undefined,
      selectedBogoSecond: {},
      selectedFreeGifts: {},
    },
    setSelectedBogoSecond: h.setSelectedBogoSecond,
    setSelectedFreeGift: h.setSelectedFreeGift,
  };
};

beforeEach(() => {
  h.setSelectedBogoSecond = vi.fn();
  h.setSelectedFreeGift = vi.fn();
});

describe('PromotionOfferManager — BOGO popup', () => {
  it('после выбора пиццы попап НЕ переоткрывается, даже если пересчёт вернул оффер снова', async () => {
    const user = userEvent.setup();
    setCart(makeCalc([makeBogoOffer()]));
    const { rerender } = render(<PromotionOfferManager />);

    // попап открылся, выбираем пиццу и подтверждаем
    await screen.findByRole('dialog');
    await user.click(screen.getAllByRole('radio')[0]);
    await user.click(screen.getByRole('button', { name: 'Auswahl übernehmen' }));
    expect(h.setSelectedBogoSecond).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Пересчёт корзины: НОВЫЙ расчёт, оффер всё ещё есть (2+ пиццы). Корзина та же.
    setCart(makeCalc([makeBogoOffer()]));
    rerender(<PromotionOfferManager />);
    await new Promise((r) => setTimeout(r, 0));

    // КРИТИЧНО: попап не переоткрылся.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('open trigger срабатывает один раз на одно Angebot-событие', async () => {
    const user = userEvent.setup();
    setCart(makeCalc([makeBogoOffer()]));
    const { rerender } = render(<PromotionOfferManager />);
    await screen.findByRole('dialog');
    await user.click(screen.getAllByRole('radio')[0]);
    await user.click(screen.getByRole('button', { name: 'Auswahl übernehmen' }));

    // несколько пересчётов подряд с тем же оффером и той же корзиной — попапа нет
    for (let i = 0; i < 3; i++) {
      setCart(makeCalc([makeBogoOffer()]));
      rerender(<PromotionOfferManager />);
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    }
  });

  it('после ИЗМЕНЕНИЯ корзины (новое событие) попап может открыться снова', async () => {
    const user = userEvent.setup();
    setCart(makeCalc([makeBogoOffer()]));
    const { rerender } = render(<PromotionOfferManager />);
    await screen.findByRole('dialog');
    await user.click(screen.getAllByRole('radio')[0]);
    await user.click(screen.getByRole('button', { name: 'Auswahl übernehmen' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Корзина изменилась (добавили ещё пиццу) → новое валидное Angebot-событие.
    setCart(makeCalc([makeBogoOffer()]), [
      { id: 'p1', productId: 'p1', name: 'Bayern', size: { name: '' }, quantity: 3, price: 10 },
    ]);
    rerender(<PromotionOfferManager />);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeInTheDocument());
  });
});
