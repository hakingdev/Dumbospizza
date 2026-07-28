// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PromotionCalculationResult } from '../../../lib/promotions/types';
import PromotionCartSummary from '../PromotionCartSummary';

function baseCalc(over: Partial<PromotionCalculationResult> = {}): PromotionCalculationResult {
  return {
    subtotal: 33,
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
  promotionName: 'Gratis-Artikel ab 25 €',
  label: 'Gratis-Artikel — wählen Sie 1 aus',
  options: [
    { id: 'chicken|340g', productId: 'chicken', sizeName: '340g', name: 'Chicken and Cheese Layer 340g' },
    { id: 'wasser|0,5l', productId: 'wasser', sizeName: '0,5l', name: 'Wasser 0,5l' },
  ],
};

const calc = baseCalc({ freeGiftOffers: [offer] });

describe('PromotionCartSummary — подарок можно выбрать повторно', () => {
  it('без onPickGift (CartModal): ожидающий подарок — только текст, без кнопки', () => {
    const html = renderToStaticMarkup(
      <PromotionCartSummary calculation={calc} selectedFreeGifts={{}} declinedFreeGifts={{}} />
    );
    expect(html).toContain('Gratis-Artikel — bitte auswählen');
    expect(html).not.toContain('<button');
  });

  it('с onPickGift (checkout): ожидающий подарок — кликабельная кнопка', () => {
    const html = renderToStaticMarkup(
      <PromotionCartSummary
        calculation={calc}
        selectedFreeGifts={{}}
        declinedFreeGifts={{}}
        onPickGift={() => {}}
      />
    );
    expect(html).toContain('<button');
    expect(html).toContain('Gratis-Artikel — bitte auswählen');
  });

  it('подарок удалён/отклонён: с onPickGift есть кнопка вернуть его', () => {
    const html = renderToStaticMarkup(
      <PromotionCartSummary
        calculation={calc}
        selectedFreeGifts={{}}
        declinedFreeGifts={{ gift1: true }}
        onPickGift={() => {}}
      />
    );
    expect(html).toContain('<button');
    expect(html).toContain('Gratis-Artikel doch auswählen');
  });

  it('подарок удалён/отклонён без onPickGift: ничего не показываем (как раньше)', () => {
    const html = renderToStaticMarkup(
      <PromotionCartSummary
        calculation={calc}
        selectedFreeGifts={{}}
        declinedFreeGifts={{ gift1: true }}
      />
    );
    expect(html).toBe('');
  });

  it('подарок уже выбран: кнопки выбора нет', () => {
    const html = renderToStaticMarkup(
      <PromotionCartSummary
        calculation={calc}
        selectedFreeGifts={{ gift1: 'chicken|340g' }}
        declinedFreeGifts={{}}
        onPickGift={() => {}}
      />
    );
    expect(html).toBe('');
  });
});
