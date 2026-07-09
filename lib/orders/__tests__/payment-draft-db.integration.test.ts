// @vitest-environment node
//
// Интеграционная проверка SQL промоута драфта против живого Postgres —
// гейт RUN_DB_TESTS=1 (паттерн lib/orders/__tests__/order-insert.test.ts).
//
// Проверяется именно то, что не покрывает in-memory стор: синтаксис и
// семантика guarded UPDATE (CASE по status, COALESCE по order_number,
// jsonb-конкатенация status_updates), CAS-повтор, реальный код ошибки 23505
// уникального индекса orders_order_number_uq и выборка markStaleDraftsFailed.
//
// Тестовые строки создаются с kitchenPrintStatus='completed' (принт-агент их
// не заберёт) и удаляются в afterAll. Фильтр markStaleDraftsFailed матчит
// только status='pending_payment' — реальные заказы («new» и далее) не
// затрагиваются, а помеченный failed драфт поздний PAID всё равно промоутит.
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, afterAll } from 'vitest';
import { inArray } from 'drizzle-orm';
import { genObjectId } from '../../db/object-id';

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return;
  for (const f of ['.env.local', '.env']) {
    try {
      const txt = readFileSync(resolve(process.cwd(), f), 'utf8');
      const line = txt.split('\n').find((l) => l.trim().startsWith('DATABASE_URL='));
      if (line) {
        process.env.DATABASE_URL = line
          .slice(line.indexOf('=') + 1)
          .trim()
          .replace(/^["']|["']$/g, '');
        return;
      }
    } catch {
      /* нет файла — пропускаем */
    }
  }
}

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

const stamp = Date.now();
const draftId = genObjectId();
const legacyId = genObjectId();
const secondDraftId = genObjectId();
const staleDraftId = genObjectId();
const testIds = [draftId, legacyId, secondDraftId, staleDraftId];

const num = (suffix: string) => `T${stamp}${suffix}`.slice(0, 20);

function draftRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    orderNumber: null as string | null,
    customerName: 'TEST payment-draft (nicht bedienen)',
    phoneNumber: '+490000000000',
    items: [],
    deliveryType: 'pickup',
    deliveryFee: 0,
    subtotal: 9.99,
    tax: 0,
    total: 9.99,
    paymentMethod: 'online',
    paymentStatus: 'pending',
    status: 'pending_payment',
    kitchenPrintStatus: 'completed',
    customerPrintStatus: 'completed',
    statusUpdates: [{ status: 'pending_payment', timestamp: new Date().toISOString() }],
    ...overrides,
  };
}

d('claimPaidAndPromoteWithExecutor — живой Postgres (RUN_DB_TESTS=1)', () => {
  loadDatabaseUrl();

  afterAll(async () => {
    const { default: db } = await import('../../db/client');
    const { orders } = await import('../../db/schema');
    await db.delete(orders).where(inArray(orders.id, testIds));
  });

  it('промоутит драфт: completed + new + номер + запись истории', async () => {
    const { default: db } = await import('../../db/client');
    const { orders } = await import('../../db/schema');
    const { claimPaidAndPromoteWithExecutor } = await import('../payment-draft');

    await db.insert(orders).values(draftRow(draftId) as any);

    const promoted = await claimPaidAndPromoteWithExecutor(db, draftId, num('A'));

    expect(promoted).not.toBeNull();
    expect(promoted!.paymentStatus).toBe('completed');
    expect(promoted!.status).toBe('new');
    expect(promoted!.orderNumber).toBe(num('A'));
    const updates = promoted!.statusUpdates as any[];
    expect(updates).toHaveLength(2);
    expect(updates[1].status).toBe('new');
  });

  it('CAS: повторный промоут того же заказа → null (уже completed)', async () => {
    const { default: db } = await import('../../db/client');
    const { claimPaidAndPromoteWithExecutor } = await import('../payment-draft');

    const again = await claimPaidAndPromoteWithExecutor(db, draftId, num('B'));
    expect(again).toBeNull();
  });

  it('легаси-заказ (new + номер): COALESCE не трогает номер, история без дублей', async () => {
    const { default: db } = await import('../../db/client');
    const { orders } = await import('../../db/schema');
    const { claimPaidAndPromoteWithExecutor } = await import('../payment-draft');

    await db.insert(orders).values(
      draftRow(legacyId, {
        orderNumber: num('L'),
        status: 'new',
        statusUpdates: [{ status: 'new', timestamp: new Date().toISOString() }],
      }) as any
    );

    const promoted = await claimPaidAndPromoteWithExecutor(db, legacyId, num('X'));

    expect(promoted).not.toBeNull();
    expect(promoted!.orderNumber).toBe(num('L')); // кандидат проигнорирован
    expect(promoted!.status).toBe('new');
    expect((promoted!.statusUpdates as any[]).map((s) => s.status)).toEqual(['new']);
  });

  it('конфликт нумерации: занятый номер даёт распознаваемый 23505', async () => {
    const { default: db } = await import('../../db/client');
    const { orders } = await import('../../db/schema');
    const { claimPaidAndPromoteWithExecutor, isUniqueViolation } = await import(
      '../payment-draft'
    );

    await db.insert(orders).values(draftRow(secondDraftId) as any);

    // num('A') уже занят первым промоутом → уникальный индекс должен сработать.
    let caught: unknown = null;
    try {
      await claimPaidAndPromoteWithExecutor(db, secondDraftId, num('A'));
    } catch (error) {
      caught = error;
    }
    expect(caught).not.toBeNull();
    expect(isUniqueViolation(caught)).toBe(true);

    // Ретрай со свежим кандидатом добивает промоут (что и делает оркестрация).
    const promoted = await claimPaidAndPromoteWithExecutor(db, secondDraftId, num('C'));
    expect(promoted?.orderNumber).toBe(num('C'));
  });

  it('markStaleDraftsFailed: метит только неоплаченные драфты старше cutoff', async () => {
    const { default: db } = await import('../../db/client');
    const { orders } = await import('../../db/schema');
    const { getPaymentDraftStore, setPaymentDraftStoreForTests } = await import(
      '../payment-draft'
    );

    await db.insert(orders).values(
      draftRow(staleDraftId, {
        createdAt: new Date(Date.now() - 2 * 60 * 60_000), // 2 часа назад
      }) as any
    );

    setPaymentDraftStoreForTests(null); // настоящий drizzle-стор
    const store = getPaymentDraftStore();
    const marked = await store.markStaleDraftsFailed(new Date(Date.now() - 45 * 60_000));

    const ids = marked.map((m) => m.id);
    expect(ids).toContain(staleDraftId);
    // Уже оплаченные/промоученные тестовые заказы не затронуты.
    expect(ids).not.toContain(draftId);
    expect(ids).not.toContain(legacyId);

    const row = await store.getOrder(staleDraftId);
    expect(row?.paymentStatus).toBe('failed');
    expect(row?.status).toBe('pending_payment'); // остаётся невидимым
  });
});
