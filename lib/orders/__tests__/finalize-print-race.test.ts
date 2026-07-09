// @vitest-environment node
//
// Регрессия бага «двойной чек при печати через принт-агент».
//
// Сценарий из жизни (два заказа с интервалом ~1 минута): пока finalizeOrderPlacement
// ждёт медленные уведомления (Telegram/WhatsApp/CAPI — fetch без таймаута),
// принт-агент успевает пройти полный цикл: claim (pending→printing) → печать →
// mark-printed (→completed). После этого хвост finalize сохранял ЗАКАЗ ЦЕЛИКОМ
// со stale-снапшотом kitchenPrintStatus='pending' (снятым при создании заказа) —
// заказ возвращался в очередь печати, и следующий тик агента печатал второй чек.
//
// Тест гоняет НАСТОЯЩИЕ mongoose-compat (через fake db) и finalizeOrderPlacement;
// «агент» симулируется внутри мока sendOrderNotification: он завершает цикл печати
// (kitchenPrintStatus → 'completed'), пока finalize ждёт Telegram.
// Ожидание: после finalize заказ ОСТАЁТСЯ 'completed' и не печатается повторно.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- fake db: интерпретирует ровно те цепочки Drizzle, что строит mongoose-compat ---
const { fakeState, fakeDb } = vi.hoisted(() => {
  const fakeState: {
    rows: Record<string, any>[];
    updates: { sets: Record<string, any> }[];
  } = { rows: [], updates: [] };

  function chain(kind: 'select' | 'update' | 'insert' | 'delete') {
    const state: any = {};
    const exec = async () => {
      if (kind === 'select') return fakeState.rows.map((r) => ({ ...r }));
      if (kind === 'update') {
        // Пишем то, что передал compat-слой, — это и есть система под тестом:
        // полный документ (старое поведение) или только изменённые поля (фикс).
        fakeState.updates.push({ sets: state.sets });
        Object.assign(fakeState.rows[0], state.sets);
        return state.returning ? fakeState.rows.map((r) => ({ ...r })) : undefined;
      }
      if (kind === 'insert') {
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

vi.mock('../../db/client', () => ({ default: fakeDb, db: fakeDb }));

// --- Побочные эффекты finalize: без сети/БД ---
const { sendOrderNotification, printedReceipts } = vi.hoisted(() => ({
  sendOrderNotification: vi.fn(),
  printedReceipts: [] as string[],
}));

vi.mock('../../telegram', () => ({ sendOrderNotification }));
vi.mock('../../whatsapp', () => ({ sendOrderPlacedNotification: vi.fn(async () => true) }));
vi.mock('../../conversions/server-purchase-events', () => ({
  sendServerPurchaseConversionEvents: vi.fn(async () => undefined),
}));
vi.mock('../../printing', () => ({
  printOrderReceipts: vi.fn(async () => ({ kitchen: false, customer: false })),
}));
vi.mock('../../models/coupon.model', () => ({ Coupon: { findOne: vi.fn(async () => null) } }));
vi.mock('../../loyalty/service', () => ({ redeemPointsForOrder: vi.fn() }));
vi.mock('../../loyalty/config', () => ({
  getLoyaltyRules: vi.fn(async () => ({ pointValueEuro: 1 })),
}));
vi.mock('../../promotions/order-integration', () => ({
  recordPromotionOrderAnalytics: vi.fn(async () => undefined),
}));

import { Order } from '../../models/order.model';
import { finalizeOrderPlacement } from '../finalize';

function baseOrderRow(): Record<string, any> {
  const now = new Date();
  return {
    id: 'ord_1',
    orderNumber: '260709001',
    user: null,
    customerName: 'Test Kunde',
    phoneNumber: '015112345678',
    email: null,
    items: [
      { product: 'p1', name: 'Pizza Salami', quantity: 1, price: 10, totalPrice: 10 },
    ],
    deliveryType: 'pickup',
    deliveryAddress: null,
    deliveryZone: null,
    deliveryFee: 0,
    subtotal: 10,
    tax: 0,
    discount: null,
    promotionDiscount: 0,
    promotionPromoCode: null,
    appliedPromotions: [],
    freeGifts: [],
    loyaltyPointsUsed: 0,
    loyaltyPointsEarned: null,
    total: 10,
    paymentMethod: 'cash',
    paymentStatus: 'pending',
    status: 'new',
    notes: null,
    desiredDeliveryTime: null,
    telegramMessageId: null,
    mewsOrderId: null,
    kitchenPrintStatus: 'pending',
    customerPrintStatus: 'pending',
    statusUpdates: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Симуляция полного цикла принт-агента на стороне сервера:
 * claim (pending→printing) → печать чека → mark-printed (→completed).
 * Claim атомарный (как UPDATE ... WHERE kitchen_print_status='pending'):
 * повторный вызов на уже забранном заказе НЕ печатает второй чек.
 */
function agentPrintCycle(row: Record<string, any>) {
  if (row.kitchenPrintStatus !== 'pending') return; // claim не прошёл
  row.kitchenPrintStatus = 'printing';
  printedReceipts.push(String(row.orderNumber));
  row.kitchenPrintStatus = 'completed';
}

const req: any = {};

beforeEach(() => {
  vi.clearAllMocks();
  fakeState.rows = [baseOrderRow()];
  fakeState.updates = [];
  printedReceipts.length = 0;
  // На Vercel локального принтера нет — finalize идёт по ветке принт-агента.
  delete process.env.KITCHEN_PRINTER_INTERFACE;
  delete process.env.PRINTER_INTERFACE;
  delete process.env.CUSTOMER_PRINTER_INTERFACE;
});

describe('finalizeOrderPlacement vs принт-агент — гонка статуса печати', () => {
  it('заказ, напечатанный агентом во время уведомлений, остаётся completed (не возвращается в очередь)', async () => {
    // Telegram отвечает медленно; за это время агент успевает напечатать заказ.
    sendOrderNotification.mockImplementation(async () => {
      agentPrintCycle(fakeState.rows[0]);
      return 42; // message_id → finalize сделает order.save() для telegramMessageId
    });

    const order = await Order.findOne({ _id: 'ord_1' });
    expect(order).not.toBeNull();

    await finalizeOrderPlacement(order, req);

    // Чек напечатан ровно один раз…
    expect(printedReceipts).toEqual(['260709001']);
    // …и finalize НЕ вернул заказ в очередь печати (иначе следующий тик агента
    // напечатал бы второй чек).
    expect(fakeState.rows[0].kitchenPrintStatus).toBe('completed');

    // Повторный тик агента (следующий polling): дубля быть не должно.
    agentPrintCycle(fakeState.rows[0]);
    expect(printedReceipts).toEqual(['260709001']);
  });

  it('сохранение telegramMessageId не затирает статус печати, выставленный агентом', async () => {
    sendOrderNotification.mockImplementation(async () => {
      agentPrintCycle(fakeState.rows[0]);
      return 42;
    });

    const order = await Order.findOne({ _id: 'ord_1' });
    await finalizeOrderPlacement(order, req);

    // telegramMessageId сохранён…
    expect(fakeState.rows[0].telegramMessageId).toBe(42);
    // …но ни один UPDATE из finalize не должен был записать kitchenPrintStatus='pending'
    // ПОСЛЕ того, как агент выставил completed.
    const staleWrites = fakeState.updates.filter(
      (u) => u.sets && u.sets.kitchenPrintStatus === 'pending'
    );
    expect(staleWrites).toEqual([]);
  });
});
