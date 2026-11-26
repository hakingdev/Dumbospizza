// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  EXPO_RECEIPTS_URL,
  EXPO_SEND_URL,
  buildMessages,
  fetchExpoReceipts,
  isExpoPushToken,
  sendExpoMessages,
} from '../expo';
import { planReceiptUpdates, RECEIPT_TTL_MS } from '../receipts';
import {
  parseCampaignInput,
  parseRegisterBody,
  parseUnregisterBody,
  selectAudienceTokens,
} from '../validate';

const tok = (n: number | string) => `ExponentPushToken[abcdefghij${n}]`;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('register validation', () => {
  const valid = { token: tok(1), platform: 'ios', promoOptIn: true };

  it('accepts the contract body and normalizes phone/email', () => {
    const r = parseRegisterBody({
      ...valid,
      phoneNumber: '0151 2345 6789',
      email: ' Kunde@Example.DE ',
      locale: 'de-DE',
      appVersion: '1.2.0',
    });
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({
      token: tok(1),
      platform: 'ios',
      phoneNumber: '+4915123456789',
      email: 'kunde@example.de',
      locale: 'de-DE',
      appVersion: '1.2.0',
      promoOptIn: true,
    });
  });

  it('accepts the newer ExpoPushToken prefix', () => {
    expect(isExpoPushToken('ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]')).toBe(true);
  });

  it.each([
    ['missing token', { platform: 'ios', promoOptIn: true }],
    ['FCM token', { ...valid, token: 'fcm:APA91bHPRgkF3JUikC4ENAHEeMrd41Zxv3hVZjC9KtT8' }],
    ['empty brackets', { ...valid, token: 'ExponentPushToken[]' }],
    ['web platform', { ...valid, platform: 'web' }],
    ['promoOptIn as string', { ...valid, promoOptIn: 'true' }],
    ['promoOptIn missing', { token: tok(1), platform: 'android' }],
    ['not an object', 'hello'],
  ])('rejects %s', (_label, body) => {
    expect(parseRegisterBody(body).ok).toBe(false);
  });

  it('drops invalid optional fields instead of failing', () => {
    const r = parseRegisterBody({ ...valid, phoneNumber: '12', email: 'nope' });
    expect(r.ok).toBe(true);
    expect(r.value!.phoneNumber).toBeNull();
    expect(r.value!.email).toBeNull();
  });

  it('unregister needs a valid token', () => {
    expect(parseUnregisterBody({ token: tok(2) }).ok).toBe(true);
    expect(parseUnregisterBody({ token: 'x' }).ok).toBe(false);
  });
});

describe('campaign input', () => {
  const now = new Date('2026-11-26T12:00:00Z');
  const base = { title: 'Hallo', body: 'Pizza!', audience: 'all' };

  it('defaults to promo, send-now', () => {
    const r = parseCampaignInput(base, now);
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({ kind: 'promo', scheduledAt: null, url: null, promoCode: null });
  });

  it('only allows app deep links from the contract', () => {
    for (const url of ['/product/66a1b2c3d4e5f60718293a4b', '/menu?category=pizza', '/cart', '/home', '/account/loyalty', '/order/abc123/tracking']) {
      expect(parseCampaignInput({ ...base, url }, now).ok).toBe(true);
    }
    for (const url of ['https://evil.example', '/admin', '/product/../x', 'javascript:alert(1)']) {
      expect(parseCampaignInput({ ...base, url }, now).ok).toBe(false);
    }
  });

  it('rejects past or far-future schedules and over-long text', () => {
    expect(parseCampaignInput({ ...base, scheduledAt: '2026-11-26T10:00:00Z' }, now).ok).toBe(false);
    expect(parseCampaignInput({ ...base, scheduledAt: '2027-06-01T10:00:00Z' }, now).ok).toBe(false);
    expect(parseCampaignInput({ ...base, title: 'x'.repeat(66) }, now).ok).toBe(false);
    expect(parseCampaignInput({ ...base, imageUrl: 'http://insecure/img.jpg' }, now).ok).toBe(false);
    const ok = parseCampaignInput({ ...base, scheduledAt: '2026-11-27T17:00:00Z' }, now);
    expect(ok.value!.scheduledAt!.toISOString()).toBe('2026-11-27T17:00:00.000Z');
  });
});

describe('audience / opt-in filtering', () => {
  const devices = [
    { token: tok('a'), platform: 'ios', active: true, promoOptIn: true },
    { token: tok('b'), platform: 'android', active: true, promoOptIn: false },
    { token: tok('c'), platform: 'android', active: true, promoOptIn: true },
    { token: tok('d'), platform: 'ios', active: false, promoOptIn: true },
    { token: 'legacy-fcm-token', platform: 'android', active: true, promoOptIn: true },
    { token: tok('a'), platform: 'ios', active: true, promoOptIn: true },
  ];

  it('promo goes only to opted-in, active, Expo devices (deduplicated)', () => {
    expect(selectAudienceTokens(devices, { kind: 'promo', audience: 'all' })).toEqual([tok('a'), tok('c')]);
  });

  it('info reaches every active device regardless of opt-in', () => {
    expect(selectAudienceTokens(devices, { kind: 'info', audience: 'all' })).toEqual([tok('a'), tok('b'), tok('c')]);
  });

  it('filters by platform', () => {
    expect(selectAudienceTokens(devices, { kind: 'promo', audience: 'ios' })).toEqual([tok('a')]);
    expect(selectAudienceTokens(devices, { kind: 'info', audience: 'android' })).toEqual([tok('b'), tok('c')]);
  });
});

describe('Expo sending', () => {
  const content = {
    title: 'T',
    body: 'B',
    imageUrl: 'https://cdn.example/p.jpg',
    data: { kind: 'promo' as const, url: '/cart', promoCode: 'DUMBO10', campaignId: 'c1' },
  };

  it('builds the payload with string data and image', () => {
    const [m] = buildMessages([tok(1)], content);
    expect(m).toMatchObject({
      to: tok(1),
      title: 'T',
      body: 'B',
      data: { kind: 'promo', url: '/cart', promoCode: 'DUMBO10', campaignId: 'c1' },
      richContent: { image: 'https://cdn.example/p.jpg' },
    });
  });

  it('batches by 100 and maps tickets back to tokens', async () => {
    const tokens = Array.from({ length: 250 }, (_, i) => tok(i));
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const batch = JSON.parse(String(init.body)) as { to: string }[];
      return jsonResponse({
        data: batch.map((m, i) =>
          i === 0
            ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }
            : { status: 'ok', id: `t-${m.to}` }
        ),
      });
    });
    const results = await sendExpoMessages(buildMessages(tokens, content), { fetchImpl, accessToken: 'secret' });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const sizes = fetchImpl.mock.calls.map((c) => JSON.parse(String(c[1].body)).length);
    expect(sizes).toEqual([100, 100, 50]);
    expect(fetchImpl.mock.calls[0][0]).toBe(EXPO_SEND_URL);
    expect((fetchImpl.mock.calls[0][1].headers as Record<string, string>).Authorization).toBe('Bearer secret');

    expect(results).toHaveLength(250);
    expect(results.filter((r) => !r.ok).map((r) => r.token)).toEqual([tok(0), tok(100), tok(200)]);
    expect(results[0].error).toBe('DeviceNotRegistered');
    expect(results[1]).toEqual({ token: tok(1), ticketId: `t-${tok(1)}`, ok: true });
  });

  it('a failed batch marks only its own tokens as errors', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      call++;
      if (call === 1) return jsonResponse({ errors: [{ code: 'TOO_MANY_REQUESTS' }] }, 429);
      const batch = JSON.parse(String(init.body)) as unknown[];
      return jsonResponse({ data: batch.map((_, i) => ({ status: 'ok', id: `x${i}` })) });
    });
    const tokens = Array.from({ length: 150 }, (_, i) => tok(i));
    const results = await sendExpoMessages(buildMessages(tokens, content), { fetchImpl, accessToken: '' });
    expect(results.slice(0, 100).every((r) => !r.ok && r.error === 'TOO_MANY_REQUESTS')).toBe(true);
    expect(results.slice(100).every((r) => r.ok)).toBe(true);
    expect((fetchImpl.mock.calls[0][1].headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('fetches receipts in batches of 1000', async () => {
    const ids = Array.from({ length: 1500 }, (_, i) => `id${i}`);
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const { ids: part } = JSON.parse(String(init.body)) as { ids: string[] };
      return jsonResponse({ data: Object.fromEntries(part.map((id) => [id, { status: 'ok' }])) });
    });
    const receipts = await fetchExpoReceipts(ids, { fetchImpl, accessToken: '' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe(EXPO_RECEIPTS_URL);
    expect(Object.keys(receipts)).toHaveLength(1500);
  });
});

describe('receipt handling', () => {
  const now = new Date('2026-11-26T12:00:00Z');
  const t = (id: string, campaignId: string, ageMs: number) => ({
    id,
    campaignId,
    token: tok(id),
    ticketId: `ticket-${id}`,
    createdAt: new Date(now.getTime() - ageMs),
  });

  it('marks delivered/error, collects dead tokens and touched campaigns', () => {
    const tickets = [t('1', 'A', 20 * 60_000), t('2', 'A', 20 * 60_000), t('3', 'B', 20 * 60_000), t('4', 'B', 20 * 60_000)];
    const plan = planReceiptUpdates(
      tickets,
      {
        'ticket-1': { status: 'ok' },
        'ticket-2': { status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } },
        'ticket-3': { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } },
        // ticket-4: receipt not ready yet
      },
      now
    );
    expect(plan.updates).toEqual([
      { id: '1', status: 'delivered', error: null },
      { id: '2', status: 'error', error: 'DeviceNotRegistered' },
      { id: '3', status: 'error', error: 'MessageTooBig' },
    ]);
    expect(plan.deadTokens).toEqual([tok('2')]);
    expect(plan.campaignIds.sort()).toEqual(['A', 'B']);
  });

  it('expires tickets whose receipt never arrived within 24h', () => {
    const plan = planReceiptUpdates([t('9', 'C', RECEIPT_TTL_MS + 1)], {}, now);
    expect(plan.updates).toEqual([{ id: '9', status: 'expired', error: 'NoReceipt' }]);
    expect(plan.deadTokens).toEqual([]);
  });
});
