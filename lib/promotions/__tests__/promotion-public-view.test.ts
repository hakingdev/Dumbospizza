import { describe, it, expect } from 'vitest';
import { toPromotionPublicView } from '../serialize';
import { isPromotionActive, getPromotionLifecycle } from '../status';

/**
 * Backend: API списка акций должен сразу отдавать всё, что нужно фронту для
 * действия с первого клика по «Zum Angebot» — в частности `slug` (для маршрута
 * /angebote/[slug]), `id`, `badgeText`, `type`. Плюс валидация активности акции.
 */

const DAY = 24 * 60 * 60 * 1000;

const makeDoc = (over: Record<string, unknown> = {}) =>
  ({
    _id: 'promo1',
    name: 'Halben Preis',
    slug: 'halben-preis',
    description: 'Zweite Pizza zum halben Preis',
    type: 'bogo',
    bogoMode: 'half_price',
    enabled: true,
    validFrom: new Date(Date.now() - DAY),
    validTo: new Date(Date.now() + DAY),
    weekdayScheduleEnabled: false,
    happyHourEnabled: false,
    activeDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    targetProductIds: [],
    targetCategoryIds: [],
    targetItems: [],
    rewardItems: [],
    giftProductIds: [],
    badgeText: '50 %',
    showInModal: true,
    showOnOffersPage: true,
    ...over,
  }) as any;

describe('toPromotionPublicView — поля для первого клика', () => {
  it('возвращает slug, id, type и badgeText, нужные фронту сразу', () => {
    const view = toPromotionPublicView(makeDoc());
    expect(view.id).toBe('promo1');
    expect(view.slug).toBe('halben-preis'); // маршрут /angebote/[slug]
    expect(view.type).toBe('bogo');
    expect(view.badgeText).toBe('50 %');
    expect(typeof view.validTo).toBe('string'); // сериализовано
  });

  it('передаёт gratisTrigger, чтобы публичная страница могла показать условие min_order', () => {
    const view = toPromotionPublicView(
      makeDoc({ type: 'gratis_article', gratisTrigger: 'min_order', minOrderAmount: 30 })
    );

    expect(view.gratisTrigger).toBe('min_order');
    expect(view.minOrderAmount).toBe(30);
  });

  it('badgeText подставляется из типа, если не задан', () => {
    const view = toPromotionPublicView(makeDoc({ badgeText: undefined }));
    expect(view.badgeText).toBe('3. 50 %'); // defaultBadgeForType(bogo, half_price) — 2+1
  });
});

describe('валидация активности акции (server source of truth)', () => {
  it('активная акция в окне дат → active', () => {
    expect(isPromotionActive(makeDoc())).toBe(true);
    expect(getPromotionLifecycle(makeDoc())).toBe('active');
  });

  it('expired / inactive нельзя активировать', () => {
    const expired = makeDoc({ validFrom: new Date(Date.now() - 2 * DAY), validTo: new Date(Date.now() - DAY) });
    expect(isPromotionActive(expired)).toBe(false);
    expect(getPromotionLifecycle(expired)).toBe('expired');

    const disabled = makeDoc({ enabled: false });
    expect(isPromotionActive(disabled)).toBe(false);
  });

  it('ещё не начавшаяся акция → scheduled, не активна', () => {
    const future = makeDoc({ validFrom: new Date(Date.now() + DAY), validTo: new Date(Date.now() + 2 * DAY) });
    expect(getPromotionLifecycle(future)).toBe('scheduled');
    expect(isPromotionActive(future)).toBe(false);
  });
});
