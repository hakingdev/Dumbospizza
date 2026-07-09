import { describe, expect, it } from 'vitest';
import { isOnlineCheckoutMethod, resolveVisibleGroups } from '../method-groups';

// Живой allowlist мерчанта SumUp (снимок /payment-methods от 2026-07-09) —
// SEPA-id в нём нет: SEPA-Lastschrift идёт funding-источником PayPal.
const LIVE_ALLOWLIST = ['card', 'apple_pay', 'google_pay', 'paypal'];

describe('resolveVisibleGroups — конфиг × allowlist SumUp', () => {
  it('пересечение, не хардкод: whitelist карточной группы урезается до доступного', () => {
    const groups = resolveVisibleGroups(['card', 'paypal']);
    const online = groups.find((g) => g.id === 'online');
    expect(online?.effectiveSumupIds).toEqual(['card']);
  });

  it('живой allowlist: карточная группа полная, PayPal и SEPA присутствуют', () => {
    const groups = resolveVisibleGroups(LIVE_ALLOWLIST);
    expect(groups.map((g) => g.id)).toEqual(['online', 'paypal', 'sepa']);
    expect(groups.find((g) => g.id === 'online')?.effectiveSumupIds).toEqual([
      'card',
      'apple_pay',
      'google_pay',
    ]);
  });

  it('SumUp не вернул ни одного id sumup-группы → группы нет совсем (ни серой, ни задизейбленной)', () => {
    const groups = resolveVisibleGroups(['paypal']);
    expect(groups.some((g) => g.id === 'online')).toBe(false);
  });

  it('PayPal-группы (paypal, sepa) не зависят от SumUp-ответа', () => {
    const cases: Array<string[] | null> = [[], null];
    for (const available of cases) {
      const ids = resolveVisibleGroups(available).map((g) => g.id);
      expect(ids).toContain('paypal');
      expect(ids).toContain('sepa');
    }
  });

  it('без NEXT_PUBLIC_PAYPAL_CLIENT_ID обе PayPal-группы скрыты', () => {
    const groups = resolveVisibleGroups(LIVE_ALLOWLIST, { paypalConfigured: false });
    expect(groups.map((g) => g.id)).toEqual(['online']);
  });

  it('allowlist недоступен (null) → фолбэк: карточная группа с полным whitelist', () => {
    const groups = resolveVisibleGroups(null);
    expect(groups.find((g) => g.id === 'online')?.effectiveSumupIds).toEqual([
      'card',
      'apple_pay',
      'google_pay',
    ]);
  });

  it('PayPal-группы несут funding-источник для standalone-кнопки', () => {
    const groups = resolveVisibleGroups(LIVE_ALLOWLIST);
    expect(groups.find((g) => g.id === 'paypal')?.paypalFundingSource).toBe('paypal');
    expect(groups.find((g) => g.id === 'sepa')?.paypalFundingSource).toBe('sepa');
  });
});

describe('isOnlineCheckoutMethod', () => {
  it.each(['online', 'paypal', 'sepa'])('%s — онлайн-метод (в БД идёт как online)', (m) => {
    expect(isOnlineCheckoutMethod(m)).toBe(true);
  });

  it.each(['cash', 'card', undefined])('%s — не онлайн-метод', (m) => {
    expect(isOnlineCheckoutMethod(m as string | undefined)).toBe(false);
  });
});
