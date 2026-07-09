// @vitest-environment node
//
// Очередь печати принт-агента: атомарный claim и явный reclaim по lease.
// Модель заменена in-memory реализацией с той же семантикой атомарности, что и
// UPDATE ... WHERE ... RETURNING в Postgres (findOneAndUpdate в mongoose-compat —
// один conditional UPDATE): из конкурирующих claim'ов на строку проходит один.
import { describe, it, expect, vi } from 'vitest';
import { claimPendingPrintOrders, confirmPrintResult } from '../print-queue';

type Row = Record<string, any>;

function matches(row: Row, query: Row): boolean {
  for (const [key, cond] of Object.entries(query)) {
    if (key === '$or') {
      if (!(cond as Row[]).some((q) => matches(row, q))) return false;
      continue;
    }
    const field = key === '_id' ? 'id' : key;
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      for (const [op, v] of Object.entries(cond as Row)) {
        const val = row[field];
        if (op === '$lte' && !(val <= (v as any))) return false;
        if (op === '$ne' && !(val !== v)) return false;
      }
      continue;
    }
    if (row[field] !== cond) return false;
  }
  return true;
}

/** In-memory модель: find отдаёт копии (как строки из БД), CAS-обновление атомарно. */
function createFakeModel(rows: Row[], nowFn: () => Date = () => new Date()) {
  return {
    rows,
    find(query: Row) {
      const run = async () => rows.filter((r) => matches(r, query)).map((r) => ({ ...r }));
      const chain: any = {
        sort: () => chain,
        limit: () => chain,
        then: (onF: any, onR: any) => run().then(onF, onR),
      };
      return chain;
    },
    async findOneAndUpdate(query: Row, update: Row) {
      // Синхронная check-and-set секция — эквивалент атомарного UPDATE ... WHERE.
      const row = rows.find((r) => matches(r, query));
      if (!row) return null;
      Object.assign(row, update.$set || {});
      row.updatedAt = nowFn(); // $onUpdate в схеме
      return { ...row, _id: row.id };
    },
  } as any;
}

function pendingOrder(id: string, num: string, overrides: Row = {}): Row {
  return {
    id,
    orderNumber: num,
    kitchenPrintStatus: 'pending',
    paymentMethod: 'cash',
    paymentStatus: 'pending',
    createdAt: new Date('2026-07-09T18:00:00Z'),
    updatedAt: new Date('2026-07-09T18:00:00Z'),
    ...overrides,
  };
}

const paymentGate = {
  $or: [{ paymentMethod: { $ne: 'online' } }, { paymentStatus: 'completed' }],
};

const silent = { log: vi.fn(), logWarn: vi.fn() };

describe('claimPendingPrintOrders — атомарный claim', () => {
  it('два параллельных тика над одним pending-заказом: claim получает ровно один', async () => {
    const rows = [pendingOrder('o1', '260709001')];
    const model = createFakeModel(rows);

    const [a, b] = await Promise.all([
      claimPendingPrintOrders(paymentGate, 10, { model, agentId: 'tick-A', ...silent }),
      claimPendingPrintOrders(paymentGate, 10, { model, agentId: 'tick-B', ...silent }),
    ]);

    expect(a.length + b.length).toBe(1);
    expect(rows[0].kitchenPrintStatus).toBe('printing');
  });

  it('два экземпляра агента над очередью из двух заказов: каждый заказ выдан один раз', async () => {
    const rows = [pendingOrder('o1', '260709001'), pendingOrder('o2', '260709002')];
    const model = createFakeModel(rows);

    const [a, b] = await Promise.all([
      claimPendingPrintOrders(paymentGate, 10, { model, agentId: 'agent-A', ...silent }),
      claimPendingPrintOrders(paymentGate, 10, { model, agentId: 'agent-B', ...silent }),
    ]);

    const claimedIds = [...a, ...b].map((o) => String(o._id));
    expect(claimedIds.length).toBe(2);
    expect(new Set(claimedIds).size).toBe(2); // без дублей
  });

  it('неоплаченный онлайн-заказ не выдаётся (гейт по оплате)', async () => {
    const rows = [
      pendingOrder('o1', '260709001', { paymentMethod: 'online', paymentStatus: 'pending' }),
      pendingOrder('o2', '260709002', { paymentMethod: 'online', paymentStatus: 'completed' }),
    ];
    const model = createFakeModel(rows);

    const claimed = await claimPendingPrintOrders(paymentGate, 10, { model, ...silent });

    expect(claimed.map((o) => String(o._id))).toEqual(['o2']);
    expect(rows[0].kitchenPrintStatus).toBe('pending');
  });
});

describe('claimPendingPrintOrders — reclaim зависших printing по lease', () => {
  const NOW = new Date('2026-07-09T18:20:00Z');
  const leaseMs = 10 * 60_000;

  it('printing старше lease выдаётся повторно с предупреждением в логе', async () => {
    const rows = [
      pendingOrder('stuck', '260709001', {
        kitchenPrintStatus: 'printing',
        updatedAt: new Date(NOW.getTime() - leaseMs - 1000),
      }),
    ];
    const model = createFakeModel(rows, () => NOW);
    const logWarn = vi.fn();

    const claimed = await claimPendingPrintOrders(paymentGate, 10, {
      model,
      now: () => NOW,
      leaseMs,
      log: vi.fn(),
      logWarn,
      agentId: 'agent-A',
    });

    expect(claimed.map((o) => String(o._id))).toEqual(['stuck']);
    expect(logWarn).toHaveBeenCalledTimes(1);
    expect(logWarn.mock.calls[0][0]).toContain('decision=reclaimed_stale');
    // lease продлён — updatedAt обновлён самим reclaim'ом
    expect(rows[0].updatedAt).toEqual(NOW);
  });

  it('printing МОЛОЖЕ lease не трогается (агент ещё печатает)', async () => {
    const rows = [
      pendingOrder('busy', '260709001', {
        kitchenPrintStatus: 'printing',
        updatedAt: new Date(NOW.getTime() - 30_000),
      }),
    ];
    const model = createFakeModel(rows, () => NOW);

    const claimed = await claimPendingPrintOrders(paymentGate, 10, {
      model,
      now: () => NOW,
      leaseMs,
      ...silent,
    });

    expect(claimed).toEqual([]);
  });

  it('два конкурирующих reclaim\'а: заказ достаётся одному (updatedAt-CAS)', async () => {
    const rows = [
      pendingOrder('stuck', '260709001', {
        kitchenPrintStatus: 'printing',
        updatedAt: new Date(NOW.getTime() - leaseMs - 1000),
      }),
    ];
    const model = createFakeModel(rows, () => NOW);

    const [a, b] = await Promise.all([
      claimPendingPrintOrders(paymentGate, 10, { model, now: () => NOW, leaseMs, ...silent }),
      claimPendingPrintOrders(paymentGate, 10, { model, now: () => NOW, leaseMs, ...silent }),
    ]);

    expect(a.length + b.length).toBe(1);
  });
});

describe('confirmPrintResult — идемпотентное подтверждение', () => {
  it('повторное подтверждение не меняет терминальный статус и не падает', async () => {
    const rows = [pendingOrder('o1', '260709001', { kitchenPrintStatus: 'printing' })];
    const model = createFakeModel(rows);

    await confirmPrintResult('o1', true, { model, ...silent });
    expect(rows[0].kitchenPrintStatus).toBe('completed');

    const again = await confirmPrintResult('o1', true, { model, ...silent });
    expect(again).not.toBeNull();
    expect(rows[0].kitchenPrintStatus).toBe('completed');
  });

  it('неизвестный заказ → null (роут ответит 404)', async () => {
    const model = createFakeModel([]);
    expect(await confirmPrintResult('ghost', true, { model, ...silent })).toBeNull();
  });
});
