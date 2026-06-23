// @vitest-environment node
//
// Регрессия бага «Punkte не уменьшаются»:
// Сумма заказа и order.loyaltyPointsUsed фиксируются ещё при СОЗДАНИИ заказа,
// а фактическое списание баллов идёт в finalizeOrderPlacement. Раньше результат
// redeem полностью проглатывался try/catch: если списание не проходило, заказ
// оставался со «списанными» баллами и заниженной суммой, но баланс клиента НЕ
// уменьшался → orders.loyalty_points_used расходился с loyalty_programs.balance,
// и Verfügbare Punkte в кабинете не падали.
//
// Эти тесты НЕ ходят в БД: вся бизнес-логика лояльности замокана, проверяется
// именно ПРОВОДКА finalize вокруг redeem (вызов один раз, обработка результата,
// инвариант loyaltyPointsUsed == фактическое списание).
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Моки побочных эффектов finalize (никаких реальных сетевых/БД-вызовов) ---
// vi.hoisted: фабрики vi.mock поднимаются в начало файла, поэтому моки-функции
// нужно создать в hoisted-блоке, иначе ReferenceError при инициализации.
const { redeemPointsForOrder, getLoyaltyRules } = vi.hoisted(() => ({
  redeemPointsForOrder: vi.fn(),
  getLoyaltyRules: vi.fn(async () => ({ pointValueEuro: 1 })),
}));

vi.mock('../../loyalty/service', () => ({ redeemPointsForOrder }));
vi.mock('../../loyalty/config', () => ({ getLoyaltyRules }));
vi.mock('../../models/coupon.model', () => ({
  Coupon: { findOne: vi.fn(async () => null) },
}));
vi.mock('../../promotions/order-integration', () => ({
  recordPromotionOrderAnalytics: vi.fn(async () => undefined),
}));
vi.mock('../../conversions/server-purchase-events', () => ({
  sendServerPurchaseConversionEvents: vi.fn(async () => undefined),
}));
vi.mock('../../telegram', () => ({ sendOrderNotification: vi.fn(async () => null) }));
vi.mock('../../printing', () => ({ printOrderReceipts: vi.fn(async () => ({ kitchen: false, customer: false })) }));
vi.mock('../../whatsapp', () => ({ sendOrderPlacedNotification: vi.fn(async () => true) }));

import { finalizeOrderPlacement } from '../finalize';

function makeOrder(overrides: Record<string, any> = {}) {
  const order: any = {
    _id: 'order_1',
    orderNumber: '250101001',
    user: 'user_1',
    phoneNumber: '01716286134',
    customerName: 'Yurii',
    items: [],
    deliveryType: 'pickup',
    deliveryFee: 0,
    subtotal: 27.9,
    total: 26.22,
    paymentMethod: 'card',
    paymentStatus: 'pending',
    loyaltyPointsUsed: 1.68,
    discount: undefined,
    appliedPromotions: [],
    notes: undefined,
    desiredDeliveryTime: undefined,
    save: vi.fn(async () => undefined),
    toObject: vi.fn(function (this: any) {
      return this;
    }),
    ...overrides,
  };
  return order;
}

const req: any = {};

beforeEach(() => {
  vi.clearAllMocks();
  getLoyaltyRules.mockResolvedValue({ pointValueEuro: 1 } as any);
});

describe('finalizeOrderPlacement — списание баллов', () => {
  it('успешное списание: redeem вызван один раз, заказ не меняется', async () => {
    redeemPointsForOrder.mockResolvedValue({ success: true, redeemed: 1.68, balanceAfter: 0 });
    const order = makeOrder();

    await finalizeOrderPlacement(order, req);

    expect(redeemPointsForOrder).toHaveBeenCalledTimes(1);
    expect(redeemPointsForOrder).toHaveBeenCalledWith(order);
    expect(order.loyaltyPointsUsed).toBe(1.68); // не тронуто
    expect(order.total).toBe(26.22); // сумма не тронута
  });

  it('баллы не используются (0) → redeem НЕ вызывается', async () => {
    const order = makeOrder({ loyaltyPointsUsed: 0, total: 27.9 });

    await finalizeOrderPlacement(order, req);

    expect(redeemPointsForOrder).not.toHaveBeenCalled();
    expect(order.loyaltyPointsUsed).toBe(0);
    expect(order.total).toBe(27.9);
  });

  it('РЕГРЕССИЯ: списание не прошло (insufficient) → loyaltyPointsUsed обнуляется и сумма восстанавливается', async () => {
    // Главный кейс бага: redeem вернул success:false, redeemed:0. Раньше это
    // молча проглатывалось — заказ оставался с used=1.68 и total=26.22, а баланс
    // клиента не падал. Теперь заказ приводится к реальности.
    redeemPointsForOrder.mockResolvedValue({
      success: false,
      redeemed: 0,
      balanceAfter: 1.68,
      reason: 'insufficient_balance',
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const order = makeOrder(); // total 26.22, used 1.68, pending

    await finalizeOrderPlacement(order, req);

    expect(order.loyaltyPointsUsed).toBe(0); // не «списали» баллы, которых нет
    expect(order.total).toBeCloseTo(27.9, 2); // 26.22 + 1.68 € скидки возвращены
    expect(order.save).toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled(); // расхождение залогировано, не проглочено
    errSpy.mockRestore();
  });

  it('онлайн-оплата уже completed: списание не прошло → used обнуляется, но сумму НЕ трогаем', async () => {
    redeemPointsForOrder.mockResolvedValue({
      success: false,
      redeemed: 0,
      balanceAfter: 1.68,
      reason: 'insufficient_balance',
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const order = makeOrder({ paymentMethod: 'online', paymentStatus: 'completed' });

    await finalizeOrderPlacement(order, req);

    expect(order.loyaltyPointsUsed).toBe(0);
    expect(order.total).toBe(26.22); // деньги уже списаны — сумму не меняем
    errSpy.mockRestore();
  });

  it('идемпотентность: повторная финализация (already_redeemed) ничего не меняет', async () => {
    // Сервис вернёт success:true/already_redeemed с redeemed == recorded —
    // finalize не должен ни обнулять used, ни менять сумму.
    redeemPointsForOrder.mockResolvedValue({
      success: true,
      redeemed: 1.68,
      balanceAfter: 0,
      reason: 'already_redeemed',
    });
    const order = makeOrder();

    await finalizeOrderPlacement(order, req);
    await finalizeOrderPlacement(order, req); // второй прогон (ретрай вебхука/статуса)

    expect(redeemPointsForOrder).toHaveBeenCalledTimes(2);
    expect(order.loyaltyPointsUsed).toBe(1.68);
    expect(order.total).toBe(26.22);
  });
});
