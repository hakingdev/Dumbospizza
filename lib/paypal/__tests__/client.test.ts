// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAccessToken,
  paypalGet,
  paypalPost,
  resetPayPalTokenCacheForTests,
  PayPalApiError,
} from '../client';
import { resetPayPalConfigForTests } from '../config';
import { installPayPalFetchMock, stubPayPalEnv, type PayPalFetchMock } from './paypal-fetch-mock';

describe('PayPal client — токен-кэш и PayPal-Request-Id', () => {
  let mock: PayPalFetchMock;

  beforeEach(() => {
    stubPayPalEnv();
    resetPayPalConfigForTests();
    resetPayPalTokenCacheForTests();
    mock = installPayPalFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('single-flight: параллельные запросы получают ОДИН токен-запрос', async () => {
    const [a, b, c] = await Promise.all([getAccessToken(), getAccessToken(), getAccessToken()]);
    expect(a).toBe('test-access-token');
    expect(b).toBe('test-access-token');
    expect(c).toBe('test-access-token');
    expect(mock.callsTo('/v1/oauth2/token')).toHaveLength(1);
  });

  it('кэш: повторный вызов в пределах TTL не ходит за токеном', async () => {
    await getAccessToken();
    await getAccessToken();
    expect(mock.callsTo('/v1/oauth2/token')).toHaveLength(1);
  });

  it('обновление по истечении TTL = expires_in − 60s', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T12:00:00Z'));
    await getAccessToken();
    expect(mock.callsTo('/v1/oauth2/token')).toHaveLength(1);

    // expires_in 3600 → TTL 3540s. За минуту ДО истечения — ещё кэш.
    vi.setSystemTime(new Date('2026-07-09T12:58:00Z'));
    await getAccessToken();
    expect(mock.callsTo('/v1/oauth2/token')).toHaveLength(1);

    // После TTL — новый запрос токена.
    vi.setSystemTime(new Date('2026-07-09T13:00:00Z'));
    await getAccessToken();
    expect(mock.callsTo('/v1/oauth2/token')).toHaveLength(2);
  });

  it('paypalPost без PayPal-Request-Id падает сразу (инвариант идемпотентности)', async () => {
    await expect(paypalPost('/v2/checkout/orders', {}, '')).rejects.toThrow(/PayPal-Request-Id/);
    // Никакого сетевого вызова не было.
    expect(mock.calls).toHaveLength(0);
  });

  it('каждый исходящий запрос несёт PayPal-Request-Id', async () => {
    mock.route('/v2/checkout/orders', () => ({ json: { id: 'PP-1' } }));
    await paypalPost('/v2/checkout/orders', { intent: 'CAPTURE' }, 'req-123');
    await paypalGet('/v2/checkout/orders/PP-1');

    for (const call of mock.calls) {
      expect(call.headers['paypal-request-id']).toBeTruthy();
    }
    const post = mock.callsTo('/v2/checkout/orders').find((c) => c.method === 'POST')!;
    expect(post.headers['paypal-request-id']).toBe('req-123');
  });

  it('ответ ≥ 400 → PayPalApiError с issue-кодом', async () => {
    mock.route('/v2/checkout/orders/PP-1/capture', () => ({
      status: 422,
      json: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }] },
    }));
    try {
      await paypalPost('/v2/checkout/orders/PP-1/capture', {}, 'req-1');
      expect.unreachable('должно было бросить');
    } catch (e) {
      expect(e).toBeInstanceOf(PayPalApiError);
      expect((e as PayPalApiError).status).toBe(422);
      expect((e as PayPalApiError).issue).toBe('INSTRUMENT_DECLINED');
    }
  });

  it('секрет не попадает в сообщения ошибок', async () => {
    mock.route('/v2/checkout/orders', () => ({ status: 500, json: { name: 'SERVER_ERROR' } }));
    try {
      await paypalPost('/v2/checkout/orders', {}, 'req-1');
      expect.unreachable('должно было бросить');
    } catch (e) {
      const msg = String((e as Error).message) + JSON.stringify((e as PayPalApiError).body);
      expect(msg).not.toContain('test-client-secret');
      expect(msg).not.toContain('test-access-token');
    }
  });
});
