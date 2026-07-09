// @vitest-environment node
//
// Прокси merchant-level allowlist'а SumUp: успех, кэш (второй запрос не бьёт
// SumUp), сбой SumUp → success:false (клиент уходит в фолбэк resolveVisibleGroups).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const listMock = vi.hoisted(() => vi.fn());

vi.mock('../../sumup', () => ({
  listMerchantPaymentMethods: listMock,
}));

function get(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`);
}

/** Свежий модуль роута на каждый тест — обнуляет module-level кэш. */
async function freshRoute() {
  vi.resetModules();
  return import('../../../app/api/payments/sumup/payment-methods/route');
}

describe('GET /api/payments/sumup/payment-methods — прокси allowlist', () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  it('отдаёт методы SumUp и кэширует повторный запрос с тем же ключом', async () => {
    listMock.mockResolvedValue(['card', 'apple_pay', 'google_pay', 'paypal']);
    const route = await freshRoute();

    const res1 = await route.GET(get('/api/payments/sumup/payment-methods?amount=33.90&currency=EUR'));
    expect(res1.status).toBe(200);
    await expect(res1.json()).resolves.toEqual({
      success: true,
      methods: ['card', 'apple_pay', 'google_pay', 'paypal'],
    });
    expect(listMock).toHaveBeenCalledWith({ amount: 33.9, currency: 'EUR' });

    const res2 = await route.GET(get('/api/payments/sumup/payment-methods?amount=33.90&currency=EUR'));
    expect(res2.status).toBe(200);
    await expect(res2.json()).resolves.toMatchObject({ success: true });
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it('другой ключ (сумма) — кэш не подставляется, SumUp опрашивается снова', async () => {
    listMock.mockResolvedValue(['card']);
    const route = await freshRoute();
    await route.GET(get('/api/payments/sumup/payment-methods?amount=10.00'));
    await route.GET(get('/api/payments/sumup/payment-methods?amount=20.00'));
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it('сбой SumUp → 502 и success:false, methods пустой', async () => {
    listMock.mockRejectedValue(new Error('boom'));
    const route = await freshRoute();
    const res = await route.GET(get('/api/payments/sumup/payment-methods'));
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ success: false, methods: [] });
  });
});
