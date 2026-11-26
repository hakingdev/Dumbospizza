// @vitest-environment node
//
// Страница оплаты из приложения: единственная цель редиректа (схема
// приложения), проверка токена заказа ДО деталей заказа, видимость группы по
// тем же правилам, что у чекаута сайта, и публичный /api/payments/methods.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  APP_PAYMENT_RETURN_BASE,
  buildAppReturnUrl,
  evaluateAppPayAccess,
  parseAppPayMethod,
  pickVisibleGroup,
  type AppPayOrder,
} from '../app-pay';
import { signOrderAccessToken } from '../../orders/access-token';

const listMock = vi.hoisted(() => vi.fn());
vi.mock('../../sumup', () => ({ listMerchantPaymentMethods: listMock }));

const ORDER_ID = '11111111-2222-3333-4444-555555555555';

function draft(overrides: Partial<AppPayOrder> = {}): AppPayOrder {
  return { id: ORDER_ID, paymentMethod: 'online', paymentStatus: 'pending', status: 'pending_payment', ...overrides };
}

describe('buildAppReturnUrl — только схема приложения', () => {
  it('строит dumbospizza://payment?order=&result=', () => {
    expect(buildAppReturnUrl(ORDER_ID, 'success')).toBe(`dumbospizza://payment?order=${ORDER_ID}&result=success`);
    expect(buildAppReturnUrl(ORDER_ID, 'cancel')).toBe(`dumbospizza://payment?order=${ORDER_ID}&result=cancel`);
    expect(buildAppReturnUrl(ORDER_ID, 'failed')).toBe(`dumbospizza://payment?order=${ORDER_ID}&result=failed`);
  });

  it('orderId экранируется — подменить хост/параметры через него нельзя', () => {
    const url = buildAppReturnUrl('x&result=success#https://evil.example', 'cancel');
    expect(url.startsWith(`${APP_PAYMENT_RETURN_BASE}?order=`)).toBe(true);
    const parsed = new URL(url);
    expect(parsed.protocol).toBe('dumbospizza:');
    expect(parsed.searchParams.getAll('result')).toEqual(['cancel']);
    expect(parsed.hash).toBe('');
  });
});

describe('parseAppPayMethod', () => {
  it('принимает только онлайн-группы', () => {
    expect(parseAppPayMethod('online')).toBe('online');
    expect(parseAppPayMethod('paypal')).toBe('paypal');
    expect(parseAppPayMethod('sepa')).toBe('sepa');
    expect(parseAppPayMethod('cash')).toBeNull();
    expect(parseAppPayMethod('card')).toBeNull();
    expect(parseAppPayMethod(undefined)).toBeNull();
    expect(parseAppPayMethod(['online'])).toBeNull();
  });
});

describe('evaluateAppPayAccess — токен проверяется на сервере, fail-closed', () => {
  const token = signOrderAccessToken(ORDER_ID);

  it('валидный токен + draft → ok', () => {
    expect(evaluateAppPayAccess(ORDER_ID, draft(), token)).toEqual({ ok: true });
  });

  it('нет / чужой / битый токен → forbidden, даже если заказа нет', () => {
    expect(evaluateAppPayAccess(ORDER_ID, draft(), null)).toEqual({ ok: false, reason: 'forbidden' });
    expect(evaluateAppPayAccess(ORDER_ID, draft(), signOrderAccessToken('other'))).toEqual({ ok: false, reason: 'forbidden' });
    expect(evaluateAppPayAccess(ORDER_ID, draft(), token.slice(1))).toEqual({ ok: false, reason: 'forbidden' });
    expect(evaluateAppPayAccess(ORDER_ID, null, 'nope')).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('токен ок, но заказа нет / другой id → not_found', () => {
    expect(evaluateAppPayAccess(ORDER_ID, null, token)).toEqual({ ok: false, reason: 'not_found' });
    expect(evaluateAppPayAccess(ORDER_ID, draft({ id: 'x' }), token)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('не онлайн / уже оплачен / уже не draft', () => {
    expect(evaluateAppPayAccess(ORDER_ID, draft({ paymentMethod: 'cash' }), token)).toEqual({ ok: false, reason: 'not_online' });
    expect(evaluateAppPayAccess(ORDER_ID, draft({ paymentStatus: 'completed', status: 'new' }), token)).toEqual({ ok: false, reason: 'already_paid' });
    expect(evaluateAppPayAccess(ORDER_ID, draft({ status: 'cancelled' }), token)).toEqual({ ok: false, reason: 'not_payable' });
  });

  it('draft с failed-попыткой можно оплатить снова', () => {
    expect(evaluateAppPayAccess(ORDER_ID, draft({ paymentStatus: 'failed' }), token)).toEqual({ ok: true });
  });
});

describe('pickVisibleGroup — правила resolveVisibleGroups', () => {
  it('карточная группа: whitelist = пересечение с allowlist', () => {
    expect(pickVisibleGroup('online', ['card', 'apple_pay', 'paypal'], true)?.effectiveSumupIds).toEqual(['card', 'apple_pay']);
  });
  it('карточная группа скрыта, если в allowlist ничего из неё нет', () => {
    expect(pickVisibleGroup('online', ['paypal'], true)).toBeNull();
  });
  it('allowlist недоступен (null) → карточная группа с полным whitelist', () => {
    expect(pickVisibleGroup('online', null, true)?.effectiveSumupIds).toEqual(['card', 'apple_pay', 'google_pay']);
  });
  it('PayPal / SEPA только при заданном PayPal client id', () => {
    expect(pickVisibleGroup('paypal', [], true)?.provider).toBe('paypal');
    expect(pickVisibleGroup('sepa', [], true)?.paypalFundingSource).toBe('sepa');
    expect(pickVisibleGroup('paypal', [], false)).toBeNull();
    expect(pickVisibleGroup('sepa', ['card'], false)).toBeNull();
  });
});

describe('GET /api/payments/methods — видимые группы для приложения', () => {
  async function freshRoute() {
    vi.resetModules();
    return import('../../../app/api/payments/methods/route');
  }
  const get = (url: string) => new NextRequest(`http://localhost${url}`);

  beforeEach(() => {
    listMock.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('allowlist × PayPal-флаг; сумма уходит в SumUp', async () => {
    vi.stubEnv('NEXT_PUBLIC_PAYPAL_CLIENT_ID', 'client');
    listMock.mockResolvedValue(['card', 'apple_pay']);
    const route = await freshRoute();
    const res = await route.GET(get('/api/payments/methods?amount=24.50'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    await expect(res.json()).resolves.toEqual({
      success: true,
      groups: [
        { id: 'online', provider: 'sumup', sumupIds: ['card', 'apple_pay'] },
        { id: 'paypal', provider: 'paypal', sumupIds: [] },
        { id: 'sepa', provider: 'paypal', sumupIds: [] },
      ],
    });
    expect(listMock).toHaveBeenCalledWith({ amount: 24.5, currency: 'EUR' });
  });

  it('без PayPal client id — только SumUp-группа', async () => {
    vi.stubEnv('NEXT_PUBLIC_PAYPAL_CLIENT_ID', '');
    listMock.mockResolvedValue(['card']);
    const route = await freshRoute();
    const body = await (await route.GET(get('/api/payments/methods'))).json();
    expect(body.groups.map((g: { id: string }) => g.id)).toEqual(['online']);
  });

  it('сбой SumUp → 200 и фолбэк: карточная группа с полным whitelist', async () => {
    vi.stubEnv('NEXT_PUBLIC_PAYPAL_CLIENT_ID', '');
    listMock.mockRejectedValue(new Error('boom'));
    const route = await freshRoute();
    const res = await route.GET(get('/api/payments/methods'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      groups: [{ id: 'online', provider: 'sumup', sumupIds: ['card', 'apple_pay', 'google_pay'] }],
    });
  });
});
