import { describe, it, expect } from 'vitest';
import type { PromotionCalculationResult } from '../../../lib/promotions/types';
import { resolveDisplayedFreeGifts } from '../PromotionCartSummary';

function baseCalc(over: Partial<PromotionCalculationResult> = {}): PromotionCalculationResult {
  return {
    subtotal: 30,
    productDiscountTotal: 0,
    orderDiscountTotal: 0,
    promotionDiscountTotal: 0,
    lineAdjustments: [],
    freeGifts: [],
    freeGiftOffers: [],
    bogoSecondOffers: [],
    bogoSecondItems: [],
    appliedPromotions: [],
    ...over,
  } as PromotionCalculationResult;
}

const offer = {
  promotionId: 'gift1',
  promotionName: 'Gratis Wasser ab 25 €',
  label: 'Gratis-Artikel — wählen Sie 1 aus',
  options: [
    { id: 'wasser|0,5l', productId: 'wasser', sizeName: '0,5l', name: 'Wasser 0,5l' },
    { id: 'sprite|0,33l', productId: 'sprite', sizeName: '0,33l', name: 'Sprite 0,33l' },
  ],
};

describe('resolveDisplayedFreeGifts — идемпотентность gratis-воды', () => {
  it('подарок, разрешённый сервером (freeGifts), показывается один раз', () => {
    const calc = baseCalc({
      freeGifts: [
        {
          productId: 'wasser',
          sizeName: '0,5l',
          name: 'Wasser 0,5l',
          quantity: 1,
          promotionId: 'gift1',
          promotionName: 'Gratis Wasser ab 25 €',
          label: 'Gratis-Artikel',
        },
      ],
    });
    const gifts = resolveDisplayedFreeGifts(calc, { gift1: 'wasser|0,5l' });
    expect(gifts).toHaveLength(1);
  });

  it('оффер с выбором (ещё не разрешён сервером) показывается один раз', () => {
    const calc = baseCalc({ freeGiftOffers: [offer] });
    const gifts = resolveDisplayedFreeGifts(calc, { gift1: 'wasser|0,5l' });
    expect(gifts).toHaveLength(1);
    expect(gifts[0].productId).toBe('wasser');
  });

  it('гонка пересчёта: один и тот же promotionId в freeGifts И в freeGiftOffers → НЕ дублируется', () => {
    const calc = baseCalc({
      freeGifts: [
        {
          productId: 'wasser',
          sizeName: '0,5l',
          name: 'Wasser 0,5l',
          quantity: 1,
          promotionId: 'gift1',
          promotionName: 'Gratis Wasser ab 25 €',
          label: 'Gratis-Artikel',
        },
      ],
      freeGiftOffers: [offer],
    });
    const gifts = resolveDisplayedFreeGifts(calc, { gift1: 'wasser|0,5l' });
    expect(gifts).toHaveLength(1);
    expect(gifts.filter((g) => g.promotionId === 'gift1')).toHaveLength(1);
  });

  it('без выбора оффер не показывается как подарок', () => {
    const calc = baseCalc({ freeGiftOffers: [offer] });
    expect(resolveDisplayedFreeGifts(calc, {})).toHaveLength(0);
  });

  it('две независимые gratis-акции показываются обе (не схлопываем разные promotionId)', () => {
    const offer2 = { ...offer, promotionId: 'gift2', promotionName: 'Gratis Dessert' };
    const calc = baseCalc({ freeGiftOffers: [offer, offer2] });
    const gifts = resolveDisplayedFreeGifts(calc, {
      gift1: 'wasser|0,5l',
      gift2: 'sprite|0,33l',
    });
    expect(gifts).toHaveLength(2);
  });
});
