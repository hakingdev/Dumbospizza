import { describe, it, expect } from 'vitest';
import { calculatePromotions } from '../engine';
import { giftOptionId } from '../gifts';

/**
 * Abgeschaltete Produkte/Größen dürfen NICHT mehr als Gratis-Artikel greifen.
 * Der giftCatalog (lib/promotions/gift-catalog.ts) liefert die lieferbaren
 * Schlüssel; die Engine filtert danach, bevor die Eligibility geprüft wird.
 */

const makeGratis = (over: Record<string, unknown> = {}) =>
  ({
    _id: 'g1',
    name: 'Ein Getränk gratis',
    type: 'gratis_article',
    enabled: true,
    validFrom: new Date('2020-01-01'),
    validTo: new Date('2100-01-01'),
    channel: 'all',
    audience: 'all',
    weekdayScheduleEnabled: false,
    happyHourEnabled: false,
    activeDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    gratisTrigger: 'min_order',
    minOrderAmount: 20,
    targetProductIds: [],
    targetCategoryIds: [],
    targetItems: [],
    rewardItems: [],
    giftProductIds: [],
    giftItems: [],
    ...over,
  }) as any;

const cart = [{ productId: 'pizza', name: 'Pizza', quantity: 1, unitPrice: 25 }]; // >= 20

describe('Gratis-Artikel respektiert abgeschaltete Produkte/Größen', () => {
  it('ohne giftCatalog bleibt das Verhalten unverändert (reine Engine)', () => {
    const promo = makeGratis({ giftItems: [{ productId: 'coca', sizeName: '0,33l' }] });
    const out = calculatePromotions(cart, [promo], {});
    expect(out.freeGifts).toHaveLength(1);
    expect(out.freeGifts[0].productId).toBe('coca');
  });

  it('einziges Geschenk abgeschaltet → kein Gratis-Artikel und Angebot greift nicht', () => {
    const promo = makeGratis({ giftItems: [{ productId: 'coca', sizeName: '0,33l' }] });
    const out = calculatePromotions(cart, [promo], { giftCatalog: new Set<string>() });
    expect(out.freeGifts).toHaveLength(0);
    expect(out.freeGiftOffers).toHaveLength(0);
    expect(out.appliedPromotions).toHaveLength(0);
  });

  it('abgeschaltete Größe fällt aus der Auswahl, aktive bleibt', () => {
    const promo = makeGratis({
      giftItems: [
        { productId: 'coca', sizeName: '0,33l' },
        { productId: 'coca', sizeName: '1,0l' },
        { productId: 'fanta', sizeName: '0,33l' },
      ],
    });
    const giftCatalog = new Set([
      giftOptionId('coca', '0,33l'),
      giftOptionId('fanta', '0,33l'),
    ]); // 'coca|1,0l' ist aus

    const out = calculatePromotions(cart, [promo], { giftCatalog });
    expect(out.freeGiftOffers).toHaveLength(1);
    expect(out.freeGiftOffers[0].options.map((o) => o.id)).toEqual([
      giftOptionId('coca', '0,33l'),
      giftOptionId('fanta', '0,33l'),
    ]);
  });

  it('bleibt nur eine Option übrig, wird sie direkt zum Gratis-Artikel (kein Picker)', () => {
    const promo = makeGratis({
      giftItems: [
        { productId: 'coca', sizeName: '0,33l' },
        { productId: 'fanta', sizeName: '0,33l' },
      ],
    });
    const out = calculatePromotions(cart, [promo], {
      giftCatalog: new Set([giftOptionId('fanta', '0,33l')]),
    });
    expect(out.freeGiftOffers).toHaveLength(0);
    expect(out.freeGifts).toHaveLength(1);
    expect(out.freeGifts[0].productId).toBe('fanta');
    expect(out.freeGifts[0].sizeName).toBe('0,33l');
  });

  it('Legacy giftProductIds (ohne Größe) wird ebenfalls gefiltert', () => {
    const promo = makeGratis({ giftProductIds: ['coca', 'fanta'] });
    const out = calculatePromotions(cart, [promo], {
      giftCatalog: new Set([giftOptionId('fanta', '')]),
    });
    expect(out.freeGifts).toHaveLength(1);
    expect(out.freeGifts[0].productId).toBe('fanta');
  });
});
