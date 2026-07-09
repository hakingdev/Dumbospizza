// @vitest-environment node
//
// Регрессия «двойной чек»: save() писал в UPDATE ВЕСЬ документ, затирая
// колонки, параллельно изменённые другим запросом (kitchenPrintStatus,
// выставленный принт-агентом, откатывался к stale-значению из снапшота
// документа). Теперь save() — как в Mongoose — пишет только изменённые поля,
// а без изменений вообще не ходит в БД.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fakeState, fakeDb } = vi.hoisted(() => {
  const fakeState: {
    rows: Record<string, any>[];
    updates: Record<string, any>[];
    inserts: Record<string, any>[];
  } = { rows: [], updates: [], inserts: [] };

  function chain(kind: 'select' | 'update' | 'insert' | 'delete') {
    const state: any = {};
    const exec = async () => {
      if (kind === 'select') return fakeState.rows.map((r) => ({ ...r }));
      if (kind === 'update') {
        fakeState.updates.push({ ...state.sets });
        Object.assign(fakeState.rows[0], state.sets);
        return state.returning ? fakeState.rows.map((r) => ({ ...r })) : undefined;
      }
      if (kind === 'insert') {
        fakeState.inserts.push({ ...state.values });
        fakeState.rows.push({ ...state.values });
        return undefined;
      }
      return undefined;
    };
    const c: any = {
      from: () => c,
      where: () => c,
      orderBy: () => c,
      limit: () => c,
      offset: () => c,
      values: (v: any) => ((state.values = v), c),
      set: (v: any) => ((state.sets = v), c),
      returning: () => ((state.returning = true), c),
      then: (onF: any, onR: any) => exec().then(onF, onR),
      catch: (onR: any) => exec().catch(onR),
    };
    return c;
  }

  const fakeDb = {
    select: () => chain('select'),
    selectDistinct: () => chain('select'),
    update: () => chain('update'),
    insert: () => chain('insert'),
    delete: () => chain('delete'),
  };
  return { fakeState, fakeDb };
});

vi.mock('../client', () => ({ default: fakeDb, db: fakeDb }));

import { createModel } from '../mongoose-compat';
import { orders } from '../schema';

const Model = createModel(orders);

function baseRow(): Record<string, any> {
  const now = new Date('2026-07-09T18:00:00Z');
  return {
    id: 'ord_1',
    orderNumber: '260709001',
    customerName: 'Kunde',
    phoneNumber: '0151',
    items: [],
    deliveryType: 'pickup',
    deliveryFee: 0,
    subtotal: 10,
    tax: 0,
    total: 10,
    paymentMethod: 'cash',
    paymentStatus: 'pending',
    status: 'new',
    telegramMessageId: null,
    kitchenPrintStatus: 'pending',
    customerPrintStatus: 'pending',
    statusUpdates: [],
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(() => {
  fakeState.rows = [baseRow()];
  fakeState.updates = [];
  fakeState.inserts = [];
});

describe('save() — только изменённые поля (dirty tracking)', () => {
  it('изменено одно поле → в UPDATE ровно оно', async () => {
    const doc: any = await Model.findOne({ _id: 'ord_1' });
    doc.telegramMessageId = 42;
    await doc.save();

    expect(fakeState.updates).toEqual([{ telegramMessageId: 42 }]);
  });

  it('без изменений → UPDATE не выполняется вовсе', async () => {
    const doc: any = await Model.findOne({ _id: 'ord_1' });
    doc.kitchenPrintStatus = 'pending'; // то же значение
    await doc.save();

    expect(fakeState.updates).toEqual([]);
  });

  it('колонка, изменённая параллельно другим запросом, НЕ затирается (суть бага с дублем чека)', async () => {
    const doc: any = await Model.findOne({ _id: 'ord_1' });

    // Принт-агент завершил цикл печати, пока документ висел в памяти finalize
    fakeState.rows[0].kitchenPrintStatus = 'completed';

    doc.telegramMessageId = 42;
    await doc.save();

    expect(fakeState.rows[0].kitchenPrintStatus).toBe('completed'); // не откатился в pending
    expect(fakeState.rows[0].telegramMessageId).toBe(42);
  });

  it('in-place мутация jsonb-массива детектится как изменение', async () => {
    const doc: any = await Model.findOne({ _id: 'ord_1' });
    doc.statusUpdates.push({ status: 'preparing', timestamp: '2026-07-09T18:05:00Z' });
    await doc.save();

    expect(fakeState.updates).toHaveLength(1);
    expect(Object.keys(fakeState.updates[0])).toEqual(['statusUpdates']);
  });

  it('повторный save() после сохранения без новых изменений — no-op', async () => {
    const doc: any = await Model.findOne({ _id: 'ord_1' });
    doc.status = 'preparing';
    await doc.save();
    await doc.save();

    expect(fakeState.updates).toEqual([{ status: 'preparing' }]);
  });

  it('новый документ: INSERT целиком, затем save() без изменений — no-op', async () => {
    fakeState.rows = [];
    const doc: any = new (Model as any)({
      orderNumber: '260709002',
      customerName: 'Neu',
      phoneNumber: '0152',
      items: [],
      deliveryType: 'pickup',
      deliveryFee: 0,
      subtotal: 5,
      tax: 0,
      total: 5,
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      status: 'new',
    });
    await doc.save();
    expect(fakeState.inserts).toHaveLength(1);

    await doc.save();
    expect(fakeState.updates).toEqual([]);
  });
});
