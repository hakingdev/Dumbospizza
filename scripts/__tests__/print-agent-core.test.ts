// @vitest-environment node
//
// Принт-агент: гарантия «один заказ = один чек» на стороне агента.
// Fake-сервер повторяет семантику lib/orders/print-queue.ts: атомарный claim
// pending→printing, идемпотентный mark-printed, reclaim зависших printing.
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { createPrintAgent, createPrintedStore, printIdempotencyKey } = require('../print-agent-core');

type Row = Record<string, any>;

/** Fake-сервер очереди печати (семантика print-queue.ts). */
function createFakeServer() {
  const rows: Row[] = [];
  return {
    rows,
    addOrder(id: string, orderNumber: string) {
      rows.push({ _id: id, orderNumber, kitchenPrintStatus: 'pending' });
    },
    /** Явный reclaim зависшего заказа (как по истечении lease на сервере). */
    reclaim(id: string) {
      const row = rows.find((r) => r._id === id);
      if (row && row.kitchenPrintStatus === 'printing') row.reclaimed = true;
    },
    async fetchPendingOrders() {
      const out: Row[] = [];
      for (const row of rows) {
        if (row.kitchenPrintStatus === 'pending') {
          row.kitchenPrintStatus = 'printing'; // атомарный claim
          out.push({ ...row });
        } else if (row.kitchenPrintStatus === 'printing' && row.reclaimed) {
          row.reclaimed = false; // reclaim выдаёт заказ повторно
          out.push({ ...row });
        }
      }
      return out;
    },
    async markPrinted(orderId: string) {
      const row = rows.find((r) => r._id === orderId);
      if (!row) throw new Error('mark-printed 404');
      row.kitchenPrintStatus = 'completed';
    },
  };
}

function tmpStateFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'print-agent-test-'));
  return path.join(dir, 'printed-orders.json');
}

function createTestAgent(server: ReturnType<typeof createFakeServer>, opts: Row = {}) {
  const receipts: string[] = [];
  const agent = createPrintAgent({
    fetchPendingOrders: () => server.fetchPendingOrders(),
    printReceipt: async (order: Row) => {
      if (opts.printDelayMs) await new Promise((r) => setTimeout(r, opts.printDelayMs));
      receipts.push(String(order.orderNumber));
    },
    markPrinted: opts.markPrinted || ((id: string) => server.markPrinted(id)),
    store: opts.store || createPrintedStore(tmpStateFile()),
    agentId: opts.agentId || 'test#1',
    log: vi.fn(),
    logError: vi.fn(),
  });
  return { agent, receipts };
}

describe('print-agent — «один заказ = один чек»', () => {
  it('два заказа с интервалом ~60с → ровно 2 чека (по одному на заказ)', async () => {
    const server = createFakeServer();
    const { agent, receipts } = createTestAgent(server);

    // t=0: первый заказ, тик агента
    server.addOrder('a', '260709001');
    await agent.runOnce();
    // t≈60с: второй заказ, следующие тики
    server.addOrder('b', '260709002');
    await agent.runOnce();
    await agent.runOnce(); // ещё тик — ничего нового печататься не должно

    expect(receipts).toEqual(['260709001', '260709002']);
    expect(server.rows.every((r) => r.kitchenPrintStatus === 'completed')).toBe(true);
  });

  it('заказ ошибочно вернулся в pending (stale-запись на сервере) → идемпотентный ключ не даёт второй чек', async () => {
    const server = createFakeServer();
    const { agent, receipts } = createTestAgent(server);

    server.addOrder('a', '260709001');
    await agent.runOnce();
    expect(receipts).toEqual(['260709001']);

    // Симуляция старого бага: finalize затирает completed → pending
    server.rows[0].kitchenPrintStatus = 'pending';
    await agent.runOnce();

    expect(receipts).toEqual(['260709001']); // второго чека нет
    expect(server.rows[0].kitchenPrintStatus).toBe('completed'); // подтверждение повторено
  });

  it('потерян ACK (mark-printed падает), reclaim выдаёт заказ снова → чек один, подтверждение доходит', async () => {
    const server = createFakeServer();
    const markPrinted = vi
      .fn()
      .mockRejectedValueOnce(new Error('network timeout')) // первый ACK потерян
      .mockImplementation((id: string) => server.markPrinted(id));
    const { agent, receipts } = createTestAgent(server, { markPrinted });

    server.addOrder('a', '260709001');
    await agent.runOnce(); // печать ок, ACK потерян → заказ завис в printing
    expect(receipts).toEqual(['260709001']);
    expect(server.rows[0].kitchenPrintStatus).toBe('printing');

    server.reclaim('a'); // сервер по lease выдал заказ повторно
    await agent.runOnce();

    expect(receipts).toEqual(['260709001']); // печать НЕ повторилась
    expect(server.rows[0].kitchenPrintStatus).toBe('completed');
  });

  it('агент падает между печатью и подтверждением; после рестарта повторной печати нет', async () => {
    const server = createFakeServer();
    const stateFile = tmpStateFile();
    server.addOrder('a', '260709001');

    // Экземпляр №1: печатает, «умирает» на подтверждении
    const first = createTestAgent(server, {
      store: createPrintedStore(stateFile),
      markPrinted: vi.fn().mockRejectedValue(new Error('process crashed')),
    });
    await first.agent.runOnce();
    expect(first.receipts).toEqual(['260709001']);

    // Рестарт: новый процесс, то же persistent-хранилище
    server.reclaim('a');
    const second = createTestAgent(server, { store: createPrintedStore(stateFile) });
    await second.agent.runOnce();

    expect(second.receipts).toEqual([]); // ни одного нового чека
    expect(server.rows[0].kitchenPrintStatus).toBe('completed');
  });

  it('два экземпляра агента над одной очередью → каждый заказ печатается один раз', async () => {
    const server = createFakeServer();
    server.addOrder('a', '260709001');
    server.addOrder('b', '260709002');

    const one = createTestAgent(server, { agentId: 'laptop#1', printDelayMs: 5 });
    const two = createTestAgent(server, { agentId: 'laptop#2', printDelayMs: 5 });

    await Promise.all([one.agent.runOnce(), two.agent.runOnce()]);

    const all = [...one.receipts, ...two.receipts].sort();
    expect(all).toEqual(['260709001', '260709002']); // ровно по одному чеку
    expect(server.rows.every((r) => r.kitchenPrintStatus === 'completed')).toBe(true);
  });

  it('печать дольше интервала polling\'а: параллельный тик пропускается, дублей нет', async () => {
    const server = createFakeServer();
    server.addOrder('a', '260709001');
    const { agent, receipts } = createTestAgent(server, { printDelayMs: 30 });

    // «setInterval выстрелил раньше, чем закончился предыдущий цикл»
    const [first, second] = await Promise.all([agent.runOnce(), agent.runOnce()]);

    expect([first.skipped, second.skipped].filter(Boolean)).toEqual([true]);
    expect(receipts).toEqual(['260709001']);
  });
});

describe('createPrintedStore — persistent-хранилище ключей', () => {
  it('переживает рестарт и битый файл', () => {
    const file = tmpStateFile();
    const store = createPrintedStore(file);
    store.add(printIdempotencyKey('a'));
    expect(createPrintedStore(file).has('a:kitchen')).toBe(true);

    fs.writeFileSync(file, 'не json');
    expect(createPrintedStore(file).has('a:kitchen')).toBe(false); // деградация без падения
  });

  it('вычищает ключи старше maxAgeDays при загрузке', () => {
    const file = tmpStateFile();
    const old = new Date('2026-06-01T12:00:00Z');
    const fresh = new Date('2026-07-08T12:00:00Z');
    fs.writeFileSync(
      file,
      JSON.stringify({ 'old:kitchen': old.toISOString(), 'fresh:kitchen': fresh.toISOString() })
    );

    const store = createPrintedStore(file, {
      maxAgeDays: 14,
      now: () => new Date('2026-07-09T12:00:00Z'),
    });
    expect(store.has('old:kitchen')).toBe(false);
    expect(store.has('fresh:kitchen')).toBe(true);
  });
});
