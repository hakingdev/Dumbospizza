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
  declineFreeGift: null as any,
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

const makeGiftOffer = (promotionId = 'gift1') => ({
  promotionId,
  promotionName: 'Gratis Wasser ab 25 €',
  label: 'Gratis-Artikel — wählen Sie 1 aus',
  options: [
    { id: 'wasser|0,5l', productId: 'wasser', sizeName: '0,5l', name: 'Wasser 0,5l' },
    { id: 'sprite|0,33l', productId: 'sprite', sizeName: '0,33l', name: 'Sprite 0,33l' },
  ],
});

// КАЖДЫЙ вызов — НОВАЯ ссылка расчёта (как ответ API при пересчёте).
const makeCalc = (bogoOffers: any[], giftOffers: any[] = []) =>
  ({ bogoSecondOffers: bogoOffers, freeGiftOffers: giftOffers, appliedPromotions: [] }) as any;

const setCart = (
  promotionCalculation: any,
  items?: any[],
  extra: {
    selectedFreeGifts?: Record<string, string>;
    selectedBogoSecond?: Record<string, string[]>;
  } = {}
) => {
  h.cart = {
    state: {
      items: items || [
        { id: 'p1', productId: 'p1', name: 'Bayern', size: { name: '' }, quantity: 2, price: 10 },
      ],
      promotionCalculation,
      couponCode: undefined,
      selectedBogoSecond: extra.selectedBogoSecond || {},
      selectedFreeGifts: extra.selectedFreeGifts || {},
      declinedFreeGifts: {},
    },
    setSelectedBogoSecond: h.setSelectedBogoSecond,
    setSelectedFreeGift: h.setSelectedFreeGift,
    declineFreeGift: h.declineFreeGift,
  };
};

beforeEach(() => {
  h.setSelectedBogoSecond = vi.fn();
  h.setSelectedFreeGift = vi.fn();
  h.declineFreeGift = vi.fn();
});

describe('PromotionOfferManager — BOGO popup (multi-slot)', () => {
  it('в рамках ОДНОГО расчёта попап открывается один раз (нет спама при ре-рендере)', async () => {
    const user = userEvent.setup();
    // ОДНА И ТА ЖЕ ссылка расчёта между ре-рендерами = свежего пересчёта не было.
    const calc = makeCalc([makeBogoOffer()]);
    setCart(calc);
    const { rerender } = render(<PromotionOfferManager />);

    await screen.findByRole('dialog');
    await user.click(screen.getAllByRole('radio')[0]);
    await user.click(screen.getByRole('button', { name: 'Auswahl übernehmen' }));
    expect(h.setSelectedBogoSecond).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Ре-рендеры с ТЕМ ЖЕ расчётом (без пересчёта корзины) — попап не переоткрывается
    // (защита handledCalc), даже если оффер всё ещё в расчёте.
    for (let i = 0; i < 3; i++) {
      setCart(calc);
      rerender(<PromotionOfferManager />);
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    }
  });

  it('пока есть незаполненные слоты, свежий пересчёт открывает попап для следующего слота', async () => {
    const user = userEvent.setup();
    setCart(makeCalc([makeBogoOffer()]));
    const { rerender } = render(<PromotionOfferManager />);
    await screen.findByRole('dialog');
    await user.click(screen.getAllByRole('radio')[0]);
    await user.click(screen.getByRole('button', { name: 'Auswahl übernehmen' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Свежий пересчёт (НОВАЯ ссылка), оффер ещё есть = остался незаполненный слот.
    // Корзина та же. Попап должен открыться снова — для выбора следующей награды.
    setCart(makeCalc([makeBogoOffer()]));
    rerender(<PromotionOfferManager />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeInTheDocument());
  });

  it('когда все слоты заполнены (оффер исчез из пересчёта), попап не открывается', async () => {
    const user = userEvent.setup();
    setCart(makeCalc([makeBogoOffer()]));
    const { rerender } = render(<PromotionOfferManager />);
    await screen.findByRole('dialog');
    await user.click(screen.getAllByRole('radio')[0]);
    await user.click(screen.getByRole('button', { name: 'Auswahl übernehmen' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Свежий пересчёт без оффера (все слоты заполнены) — попапа нет.
    setCart(makeCalc([]));
    rerender(<PromotionOfferManager />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('устаревший пересчёт (оффер ещё есть, выбор НЕ отражён) НЕ переоткрывает попап — нет мигания', async () => {
    const user = userEvent.setup();
    // Одна подходящая пицца = один слот. Выбираем награду и подтверждаем.
    const oneItem = [
      { id: 'p1', productId: 'p1', name: 'Bayern', size: { name: '' }, quantity: 1, price: 10 },
    ];
    setCart(makeCalc([makeBogoOffer()]), oneItem);
    const { rerender } = render(<PromotionOfferManager />);
    await screen.findByRole('dialog');
    await user.click(screen.getAllByRole('radio')[0]);
    await user.click(screen.getByRole('button', { name: 'Auswahl übernehmen' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Устаревший пересчёт (НОВАЯ ссылка): запрос ушёл ДО отправки выбора, поэтому
    // оффер ещё присутствует, а bogoSecondItems пуст. Но selectedBogoSecond уже
    // содержит выбор (1 слот заполнен). Попап НЕ должен открыться (иначе мигание).
    setCart(makeCalc([makeBogoOffer()]), oneItem, {
      selectedBogoSecond: { promo1: ['p1'] },
    });
    rerender(<PromotionOfferManager />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('отказ (Nein, danke) не переоткрывает попап на свежем пересчёте, пока корзина не изменилась', async () => {
    const user = userEvent.setup();
    setCart(makeCalc([makeBogoOffer()]));
    const { rerender } = render(<PromotionOfferManager />);
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Nein, danke' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Свежий пересчёт с тем же оффером, та же корзина — после отказа не предлагаем.
    setCart(makeCalc([makeBogoOffer()]));
    rerender(<PromotionOfferManager />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

describe('PromotionOfferManager — Gratis-Artikel popup (min order)', () => {
  it('после выбора gratis-воды попап НЕ переоткрывается при добавлении Angebot-продуктов', async () => {
    const user = userEvent.setup();
    setCart(makeCalc([], [makeGiftOffer()]));
    const { rerender } = render(<PromotionOfferManager />);

    // попап выбора подарка открылся → выбираем воду и подтверждаем
    await screen.findByRole('dialog');
    await user.click(screen.getAllByRole('radio')[0]);
    await user.click(screen.getByRole('button', { name: 'Gratis-Produkt übernehmen' }));
    expect(h.setSelectedFreeGift).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Пользователь добавляет Angebot-пиццу: корзина изменилась (dismissed сбрасывается),
    // пересчёт ещё в пути — расчёт ВСЁ ЕЩЁ содержит gratis-оффер, но вода уже выбрана.
    // КРИТИЧНО: попап не должен открыться снова (иначе вода предлагалась бы 2-3 раза).
    setCart(
      makeCalc([], [makeGiftOffer()]),
      [{ id: 'p1', productId: 'p1', name: 'Bayern', size: { name: '' }, quantity: 3, price: 10 }],
      { selectedFreeGifts: { gift1: 'wasser|0,5l' } }
    );
    rerender(<PromotionOfferManager />);
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('пока gratis-вода НЕ выбрана, попап открывается (поведение без выбора сохраняется)', async () => {
    setCart(makeCalc([], [makeGiftOffer()]));
    render(<PromotionOfferManager />);
    await screen.findByRole('dialog');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('PromotionOfferManager — все награды выбираются в ОДНОМ окне (QA #6)', () => {
  it('remaining=2: два бесплатных ролла выбираются в одном окне, окно не переоткрывается', async () => {
    const user = userEvent.setup();
    // 4 подходящих ролла = 2 незаполненных слота награды.
    const offer = { ...makeBogoOffer(), bogoMode: 'free' as const, remaining: 2 };
    setCart(makeCalc([offer]), [
      { id: 'r1', productId: 'r1', name: 'Crunch Roll', size: { name: '' }, quantity: 4, price: 10 },
    ]);
    render(<PromotionOfferManager />);
    await screen.findByRole('dialog');

    // Мультирежим: радио нет, у каждой опции кнопка «hinzufügen» (+).
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Bayern Pizza hinzufügen' }));
    await user.click(screen.getByRole('button', { name: 'Salami Pizza hinzufügen' }));
    // Оба слота заняты — добавить третью награду нельзя.
    expect(screen.getByRole('button', { name: 'Bayern Pizza hinzufügen' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Auswahl übernehmen' }));
    // ОБЕ награды применены из одного окна — раньше окно открывалось на каждый слот.
    expect(h.setSelectedBogoSecond).toHaveBeenCalledTimes(2);
    expect(h.setSelectedBogoSecond).toHaveBeenNthCalledWith(1, 'promo1', 'p1');
    expect(h.setSelectedBogoSecond).toHaveBeenNthCalledWith(2, 'promo1', 'p2');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('remaining=2: одну и ту же награду можно взять дважды (минус убирает одну)', async () => {
    const user = userEvent.setup();
    const offer = { ...makeBogoOffer(), bogoMode: 'free' as const, remaining: 2 };
    setCart(makeCalc([offer]), [
      { id: 'r1', productId: 'r1', name: 'Crunch Roll', size: { name: '' }, quantity: 4, price: 10 },
    ]);
    render(<PromotionOfferManager />);
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'Bayern Pizza hinzufügen' }));
    await user.click(screen.getByRole('button', { name: 'Bayern Pizza hinzufügen' }));
    // 2× одна опция; минус снимает одну.
    await user.click(screen.getByRole('button', { name: 'Bayern Pizza entfernen' }));
    await user.click(screen.getByRole('button', { name: 'Auswahl übernehmen' }));
    expect(h.setSelectedBogoSecond).toHaveBeenCalledTimes(1);
    expect(h.setSelectedBogoSecond).toHaveBeenCalledWith('promo1', 'p1');
  });
});

describe('PromotionOfferManager — исчезнувший оффер не замораживает попапы (QA #5)', () => {
  it('gift-оффер исчез при открытом окне → окно закрывается, а последующий BOGO-оффер ОТКРЫВАЕТСЯ', async () => {
    // 1. Оффер подарка → окно открылось (пользователь его не трогает).
    setCart(makeCalc([], [makeGiftOffer()]));
    const { rerender } = render(<PromotionOfferManager />);
    await screen.findByRole('dialog');

    // 2. Свежий пересчёт БЕЗ оффера (подарок разрешился/акция ушла) —
    //    окно должно закрыться, а open — сброситься (раньше застревал навсегда).
    setCart(makeCalc([], []));
    rerender(<PromotionOfferManager />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // 3. Добавили 2 пиццы → пересчёт с BOGO-оффером. До фикса попап НЕ открывался
    //    (open='gift' блокировал эффект), и окно 2+1 появлялось только после F5.
    setCart(makeCalc([makeBogoOffer()]), [
      { id: 'p1', productId: 'p1', name: 'Bayern', size: { name: '' }, quantity: 2, price: 10 },
    ]);
    rerender(<PromotionOfferManager />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeInTheDocument());
    expect(screen.getByText('Bayern Pizza')).toBeInTheDocument();
  });

  it('bogo-оффер исчез при открытом окне → окно закрывается и не блокирует будущие офферы', async () => {
    setCart(makeCalc([makeBogoOffer()]));
    const { rerender } = render(<PromotionOfferManager />);
    await screen.findByRole('dialog');

    // Пересчёт без оффера (пицца удалена из корзины в мини-корзине).
    setCart(makeCalc([]), [
      { id: 'p1', productId: 'p1', name: 'Bayern', size: { name: '' }, quantity: 1, price: 10 },
    ]);
    rerender(<PromotionOfferManager />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Пицца снова добавлена → оффер вернулся → попап открывается.
    setCart(makeCalc([makeBogoOffer()]), [
      { id: 'p1', productId: 'p1', name: 'Bayern', size: { name: '' }, quantity: 2, price: 10 },
    ]);
    rerender(<PromotionOfferManager />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeInTheDocument());
  });
});
