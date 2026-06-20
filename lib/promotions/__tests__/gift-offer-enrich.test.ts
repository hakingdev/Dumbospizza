import { describe, it, expect } from 'vitest';
import { enrichFreeGiftOffers } from '../gifts';
import type { PromotionCalculationResult } from '../types';

function baseCalc(): PromotionCalculationResult {
  return {
    subtotal: 0,
    productDiscountTotal: 0,
    orderDiscountTotal: 0,
    promotionDiscountTotal: 0,
    lineAdjustments: [],
    freeGifts: [],
    freeGiftOffers: [
      {
        promotionId: 'promo1',
        promotionName: 'Getränk GRATIS',
        label: 'Gratis-Artikel — wählen Sie 1 aus',
        options: [
          { id: 'cola', productId: 'cola', name: 'Gratis-Artikel' },
          { id: 'sprite', productId: 'sprite', name: 'Gratis-Artikel' },
          // битый/удалённый товар — его в каталоге нет
          { id: 'ghost', productId: 'ghost', name: 'Gratis-Artikel' },
        ],
      },
    ],
    bogoSecondOffers: [],
    bogoSecondItems: [],
    appliedPromotions: [],
  };
}

describe('enrichFreeGiftOffers — фантомный «Gratis-Artikel» не попадает в список', () => {
  it('отбрасывает опцию, чей товар не найден, и подставляет реальные имена', () => {
    const products = new Map([
      ['cola', { name: 'Coca Cola 0,33l' }],
      ['sprite', { name: 'Sprite 0,33l' }],
      // 'ghost' отсутствует
    ]);

    const out = enrichFreeGiftOffers(baseCalc(), products);
    const opts = out.freeGiftOffers[0].options;

    expect(opts).toHaveLength(2);
    expect(opts.map((o) => o.name)).toEqual(['Coca Cola 0,33l', 'Sprite 0,33l']);
    expect(opts.find((o) => o.productId === 'ghost')).toBeUndefined();
    // фантомного «Gratis-Artikel» больше нет
    expect(opts.some((o) => o.name === 'Gratis-Artikel')).toBe(false);
  });

  it('добавляет размер к названию (Coca Cola 0,33l → … Family)', () => {
    const calc = baseCalc();
    calc.freeGiftOffers[0].options = [
      { id: 'cola|Family', productId: 'cola', sizeName: 'Family', name: 'Gratis-Artikel' },
    ];
    const out = enrichFreeGiftOffers(calc, new Map([['cola', { name: 'Coca Cola 0,33l' }]]));
    expect(out.freeGiftOffers[0].options[0].name).toBe('Coca Cola 0,33l Family');
  });

  it('удаляет предложение целиком, если не осталось валидных опций', () => {
    const out = enrichFreeGiftOffers(baseCalc(), new Map()); // ни один товар не найден
    expect(out.freeGiftOffers).toHaveLength(0);
  });
});
