import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  deleteAppAccount,
  normalizePushToken,
  readBearerToken,
  type AccountDeletionDeps,
  type AppAccount,
} from '../app-account-deletion';
import { handleAccountDelete } from '../account-delete-handler';

const ACCOUNT: AppAccount = { id: 'user-1', email: 'Kunde@Example.de', emailConfirmed: true };

function fakeDeps(overrides: Partial<AccountDeletionDeps> = {}) {
  const calls: string[] = [];
  const deps: AccountDeletionDeps = {
    verifyAccessToken: vi.fn(async (token: string) => (token === 'good' ? ACCOUNT : null)),
    hasOpenAppOrders: vi.fn(async () => false),
    anonymizeAppOrders: vi.fn(async () => {
      calls.push('anonymize');
      return 3;
    }),
    deletePushDevices: vi.fn(async () => {
      calls.push('push');
      return 1;
    }),
    deleteAuthUser: vi.fn(async () => {
      calls.push('auth');
    }),
    ...overrides,
  };
  return { deps, calls };
}

describe('readBearerToken', () => {
  it('reads the token from a Bearer header', () => {
    expect(readBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(readBearerToken('bearer   xyz')).toBe('xyz');
  });
  it('rejects missing or malformed headers', () => {
    expect(readBearerToken(null)).toBeNull();
    expect(readBearerToken('')).toBeNull();
    expect(readBearerToken('Basic abc')).toBeNull();
    expect(readBearerToken('Bearer')).toBeNull();
    expect(readBearerToken('Bearer a b')).toBeNull();
  });
});

describe('normalizePushToken', () => {
  it('accepts Expo push tokens only', () => {
    expect(normalizePushToken('ExponentPushToken[abc]')).toBe('ExponentPushToken[abc]');
    expect(normalizePushToken('ExpoPushToken[abc]')).toBe('ExpoPushToken[abc]');
    expect(normalizePushToken('%')).toBeNull();
    expect(normalizePushToken(42)).toBeNull();
  });
});

describe('deleteAppAccount', () => {
  it('returns 401 without a token and touches nothing', async () => {
    const { deps } = fakeDeps();
    const result = await deleteAppAccount({ accessToken: null }, deps);
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(deps.verifyAccessToken).not.toHaveBeenCalled();
    expect(deps.deleteAuthUser).not.toHaveBeenCalled();
  });

  it('returns 401 for an invalid token and touches nothing', async () => {
    const { deps } = fakeDeps();
    const result = await deleteAppAccount({ accessToken: 'forged' }, deps);
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(deps.anonymizeAppOrders).not.toHaveBeenCalled();
    expect(deps.deleteAuthUser).not.toHaveBeenCalled();
  });

  it('anonymizes orders and removes devices before deleting the auth user', async () => {
    const { deps, calls } = fakeDeps();
    const result = await deleteAppAccount(
      { accessToken: 'good', pushToken: 'ExponentPushToken[dev]' },
      deps
    );
    expect(result).toEqual({ ok: true, anonymizedOrders: 3, deletedPushDevices: 1 });
    expect(calls).toEqual(['anonymize', 'push', 'auth']);
    expect(deps.anonymizeAppOrders).toHaveBeenCalledWith('kunde@example.de');
    expect(deps.deletePushDevices).toHaveBeenCalledWith({
      email: 'kunde@example.de',
      token: 'ExponentPushToken[dev]',
    });
    expect(deps.deleteAuthUser).toHaveBeenCalledWith('user-1');
  });

  it('refuses with 409 while an app order is still open', async () => {
    const { deps } = fakeDeps({ hasOpenAppOrders: vi.fn(async () => true) });
    const result = await deleteAppAccount({ accessToken: 'good' }, deps);
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(deps.anonymizeAppOrders).not.toHaveBeenCalled();
    expect(deps.deleteAuthUser).not.toHaveBeenCalled();
  });

  it('does not link orders or devices through an unconfirmed email', async () => {
    const { deps } = fakeDeps({
      verifyAccessToken: vi.fn(async () => ({ ...ACCOUNT, emailConfirmed: false })),
    });
    const result = await deleteAppAccount({ accessToken: 'good', pushToken: 'junk' }, deps);
    expect(result).toEqual({ ok: true, anonymizedOrders: 0, deletedPushDevices: 1 });
    expect(deps.hasOpenAppOrders).not.toHaveBeenCalled();
    expect(deps.anonymizeAppOrders).not.toHaveBeenCalled();
    expect(deps.deletePushDevices).toHaveBeenCalledWith({ email: null, token: null });
    expect(deps.deleteAuthUser).toHaveBeenCalledWith('user-1');
  });

  it('keeps the auth user when the database step fails, so the client can retry', async () => {
    const { deps } = fakeDeps({
      anonymizeAppOrders: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    await expect(deleteAppAccount({ accessToken: 'good' }, deps)).rejects.toThrow('db down');
    expect(deps.deleteAuthUser).not.toHaveBeenCalled();
  });
});

function request(body: unknown, headers: Record<string, string> = {}, ip = '10.0.0.1') {
  return new NextRequest('https://www.dumbospizza.de/api/mobile/v1/account/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('handleAccountDelete (route)', () => {
  it('deletes with a valid token and confirmation', async () => {
    const { deps } = fakeDeps();
    const res = await handleAccountDelete(
      request({ confirm: true }, { authorization: 'Bearer good' }, '10.0.1.1'),
      deps
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, anonymizedOrders: 3, deletedPushDevices: 1 });
  });

  it('requires an explicit confirmation in the body', async () => {
    const { deps } = fakeDeps();
    const res = await handleAccountDelete(
      request({ confirm: 'yes' }, { authorization: 'Bearer good' }, '10.0.1.2'),
      deps
    );
    expect(res.status).toBe(400);
    expect(deps.verifyAccessToken).not.toHaveBeenCalled();
    const bad = await handleAccountDelete(request('not json', { authorization: 'Bearer good' }, '10.0.1.2'), deps);
    expect(bad.status).toBe(400);
  });

  it('answers 401 without Authorization', async () => {
    const { deps } = fakeDeps();
    const res = await handleAccountDelete(request({ confirm: true }, {}, '10.0.1.3'), deps);
    expect(res.status).toBe(401);
    expect((await res.json()).success).toBe(false);
  });

  it('hides internal errors behind a generic 500', async () => {
    const { deps } = fakeDeps({
      deleteAuthUser: vi.fn(async () => {
        throw new Error('service_role secret leaked?');
      }),
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handleAccountDelete(
      request({ confirm: true }, { authorization: 'Bearer good' }, '10.0.1.4'),
      deps
    );
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });

  it('rate-limits repeated attempts from one IP', async () => {
    const { deps } = fakeDeps();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await handleAccountDelete(request({ confirm: true }, {}, '10.0.9.9'), deps);
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });
});
