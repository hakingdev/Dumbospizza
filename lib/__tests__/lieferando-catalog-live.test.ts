// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Приём снимка каталога от агента: lib/lieferando/catalog-live (сверка,
 * хранение, закрытие команды, сообщение в группу только при изменениях) и
 * роут app/api/lieferando/agent/catalog (auth, валидация тела).
 */

vi.mock('../models', () => ({ connectToDatabase: vi.fn(async () => ({})) }));
vi.mock('../telegram-control', () => ({ sendControlMessage: vi.fn(async () => true) }));
vi.mock('../lieferando-makilove', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lieferando-makilove')>()),
  reportLieferandoResult: vi.fn(async () => ({})),
}));
vi.mock('../lieferando/catalog-store', () => ({
  getLieferandoCatalogRecord: vi.fn(async () => null),
  saveLieferandoCatalogRecord: vi.fn(async () => {}),
  loadSiteItems: vi.fn(async () => []),
}));

import { NextRequest } from 'next/server';
import { sendControlMessage } from '../telegram-control';
import { reportLieferandoResult } from '../lieferando-makilove';
import {
  getLieferandoCatalogRecord,
  loadSiteItems,
  saveLieferandoCatalogRecord,
} from '../lieferando/catalog-store';
import { receiveCatalogSnapshot } from '../lieferando/catalog-live';
import { buildCatalogRecord, reconcileCatalog, type LieferandoCatalog } from '../lieferando/catalog';
import { GET, POST } from '../../app/api/lieferando/agent/catalog/route';

const mSend = sendControlMessage as unknown as ReturnType<typeof vi.fn>;
const mReport = reportLieferandoResult as unknown as ReturnType<typeof vi.fn>;
const mGet = getLieferandoCatalogRecord as unknown as ReturnType<typeof vi.fn>;
const mSave = saveLieferandoCatalogRecord as unknown as ReturnType<typeof vi.fn>;
const mSite = loadSiteItems as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date('2026-11-04T08:05:00.000Z');

const snapshot = (): LieferandoCatalog => ({
  takenAt: '2026-11-04T08:00:00.000Z',
  failedCategories: [],
  categories: [
    { name: 'Pizza', items: [{ name: 'Hawaiian Pizza', on: true, variations: [] }] },
    { name: 'Burger', items: [{ name: 'Dry Aged Burger', on: true, variations: [] }] },
  ],
});
const SITE = [{ name: 'Hawaiian', category: 'Pizza', visible: true }];

beforeEach(() => {
  vi.clearAllMocks();
  mGet.mockResolvedValue(null);
  mSite.mockResolvedValue(SITE);
  mSend.mockResolvedValue(true);
});

describe('receiveCatalogSnapshot', () => {
  it('первый снимок: сохранён с ключами сверки, команда закрыта, сводка с «новым» ушла', async () => {
    const r = await receiveCatalogSnapshot({ id: 'cmd-1', reason: 'command', ok: true, catalog: snapshot() }, NOW);
    expect(r.stored).toBe(true);
    expect(r.notified).toBe(true);
    expect(r.changes?.newHubOnly.map((h) => h.name)).toEqual(['Dry Aged Burger']);
    expect(mSave).toHaveBeenCalledTimes(1);
    expect(mSave.mock.calls[0][0]).toMatchObject({
      takenAt: '2026-11-04T08:00:00.000Z',
      receivedAt: NOW.toISOString(),
      hubOnlyKeys: ['dryagedburger'],
      mismatchKeys: [],
    });
    expect(mReport).toHaveBeenCalledWith(
      { id: 'cmd-1', action: 'on', target: { kind: 'catalog' }, ok: true, count: 2, failed: 0, message: '' },
      NOW
    );
    expect(mSend).toHaveBeenCalledTimes(1);
    expect(mSend.mock.calls[0][0]).toContain('🆕');
    expect(mSend.mock.calls[0][0]).toContain('Burger: Dry Aged Burger');
  });

  it('тот же снимок назавтра: сохранён, но в группу — тишина; без id команда не закрывается', async () => {
    const prev = buildCatalogRecord(snapshot(), reconcileCatalog(snapshot(), SITE), '2026-11-03T08:00:00.000Z');
    mGet.mockResolvedValue(prev);
    const r = await receiveCatalogSnapshot({ reason: 'daily', ok: true, catalog: snapshot() }, NOW);
    expect(r.stored).toBe(true);
    expect(r.notified).toBe(false);
    expect(mSend).not.toHaveBeenCalled();
    expect(mReport).not.toHaveBeenCalled();
    expect(mSave).toHaveBeenCalledTimes(1);
  });

  it('не открывшаяся категория подставляется из прошлого снимка, команда закрыта с failed', async () => {
    const prev = buildCatalogRecord(snapshot(), reconcileCatalog(snapshot(), SITE), '2026-11-03T08:00:00.000Z');
    mGet.mockResolvedValue(prev);
    const current: LieferandoCatalog = {
      ...snapshot(),
      categories: snapshot().categories.filter((c) => c.name !== 'Burger'),
      failedCategories: ['Burger'],
    };
    const r = await receiveCatalogSnapshot({ id: 'cmd-2', ok: true, catalog: current }, NOW);
    expect(r.changes?.gone).toEqual([]);
    expect(r.changes?.newFailedCategories).toEqual(['Burger']);
    expect(mSave.mock.calls[0][0].categories.map((c: any) => c.name)).toEqual(['Pizza', 'Burger']);
    expect(mReport.mock.calls[0][0]).toMatchObject({ id: 'cmd-2', ok: true, count: 2, failed: 1 });
    expect(mSend.mock.calls[0][0]).toContain('Не открылись категории: Burger');
  });

  it('сбой снятия: ничего не сохраняем, команда закрыта ошибкой, сообщение о сбое', async () => {
    const r = await receiveCatalogSnapshot(
      { id: 'cmd-3', reason: 'daily', ok: false, error: 'сессия истекла', catalog: null },
      NOW
    );
    expect(r.stored).toBe(false);
    expect(mSave).not.toHaveBeenCalled();
    expect(mReport.mock.calls[0][0]).toMatchObject({ id: 'cmd-3', ok: false, message: 'сессия истекла' });
    expect(mSend.mock.calls[0][0]).toContain('Ежедневный снимок каталога Lieferando не удался');
    expect(mSend.mock.calls[0][0]).toContain('сессия истекла');
  });

  it('сбой ежечасного обновления (reason=refresh): прежний снимок остаётся, в группу — тишина', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await receiveCatalogSnapshot(
      { reason: 'refresh', ok: false, error: 'Hub не ответил', catalog: null },
      NOW
    );
    expect(r).toEqual({ stored: false, notified: false, changes: null });
    expect(mSave).not.toHaveBeenCalled();
    expect(mSend).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('POST /api/lieferando/agent/catalog', () => {
  const URL = 'http://localhost/api/lieferando/agent/catalog';
  const req = (body: unknown, key = 'secret-1') =>
    new NextRequest(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lieferando-Agent-Key': key, 'X-Lieferando-Agent-Id': 'vds' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  beforeEach(() => {
    process.env.LIEFERANDO_AGENT_SECRET = 'secret-1';
  });

  it('без секрета / с чужим — 401, ничего не делаем', async () => {
    expect((await POST(req(snapshot(), 'wrong'))).status).toBe(401);
    expect((await GET(new NextRequest(URL, { headers: { 'X-Lieferando-Agent-Key': 'wrong' } }))).status).toBe(401);
    expect(mSave).not.toHaveBeenCalled();
    expect(mSend).not.toHaveBeenCalled();
  });

  it('валидный снимок → сохранён, ответ с итогом сверки', async () => {
    const res = await POST(req({ ...snapshot(), ok: true, id: 'cmd-9', reason: 'command' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ success: true, stored: true, notified: true });
    expect(json.changes.newHubOnly[0].name).toBe('Dry Aged Burger');
    expect(mReport.mock.calls[0][0]).toMatchObject({ id: 'cmd-9', ok: true });
  });

  it('ok=false от агента → сообщение о сбое, 200', async () => {
    const res = await POST(req({ ok: false, error: 'Hub не открылся', reason: 'daily' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, stored: false });
    expect(mSend.mock.calls[0][0]).toContain('Hub не открылся');
  });

  it('пустой/битый снимок при ok → 400', async () => {
    expect((await POST(req({ ok: true, categories: [] }))).status).toBe(400);
    expect((await POST(req('{not json'))).status).toBe(400);
    expect(mSave).not.toHaveBeenCalled();
  });

  it('GET отдаёт сохранённый снимок', async () => {
    mGet.mockResolvedValue({ ...snapshot(), receivedAt: 'x', hubOnlyKeys: [], mismatchKeys: [] });
    const res = await GET(new NextRequest(URL, { headers: { 'X-Lieferando-Agent-Key': 'secret-1' } }));
    expect(res.status).toBe(200);
    expect((await res.json()).catalog.categories).toHaveLength(2);
  });
});
