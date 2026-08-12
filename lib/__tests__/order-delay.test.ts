import { beforeEach, describe, expect, it, vi } from 'vitest';

const orderMock = vi.hoisted(() => ({
  findById: vi.fn(),
}));
vi.mock('../models/order.model', () => ({ Order: orderMock, default: orderMock }));

const whatsappMock = vi.hoisted(() => ({
  sendOrderDelayNotification: vi.fn(async () => true),
}));
vi.mock('../whatsapp', () => whatsappMock);

import {
  applyOrderDelay,
  computeDelayedEtaMinutes,
  isValidDelayMinutes,
  ORDER_DELAY_CHOICES,
} from '../orders/delay';

describe('isValidDelayMinutes', () => {
  it('целые 5…60 проходят, остальное — нет', () => {
    expect(isValidDelayMinutes(10)).toBe(true);
    expect(isValidDelayMinutes(60)).toBe(true);
    expect(isValidDelayMinutes(4)).toBe(false);
    expect(isValidDelayMinutes(61)).toBe(false);
    expect(isValidDelayMinutes(12.5)).toBe(false);
    expect(isValidDelayMinutes('abc')).toBe(false);
    for (const m of ORDER_DELAY_CHOICES) expect(isValidDelayMinutes(m)).toBe(true);
  });
});

describe('computeDelayedEtaMinutes', () => {
  const now = Date.parse('2026-08-12T18:00:00Z');

  it('обещание ещё не истекло: остаток + задержка', () => {
    // Обещали 30 мин 20 минут назад → осталось 10; +15 → 25 от «сейчас».
    const setAt = new Date(now - 20 * 60_000);
    expect(computeDelayedEtaMinutes(30, setAt, 15, now)).toBe(25);
  });

  it('обещание просрочено: ровно задержка от «сейчас»', () => {
    // Обещали 20 мин 30 минут назад → просрочка 10; новое обещание = 15.
    const setAt = new Date(now - 30 * 60_000);
    expect(computeDelayedEtaMinutes(20, setAt, 15, now)).toBe(15);
  });

  it('обещания не было — просто задержка', () => {
    expect(computeDelayedEtaMinutes(null, null, 20, now)).toBe(20);
    expect(computeDelayedEtaMinutes(undefined, undefined, 10, now)).toBe(10);
  });
});

describe('applyOrderDelay', () => {
  beforeEach(() => {
    orderMock.findById.mockReset();
    whatsappMock.sendOrderDelayNotification.mockReset();
    whatsappMock.sendOrderDelayNotification.mockResolvedValue(true);
  });

  function makeOrder(overrides: Record<string, any> = {}) {
    return {
      _id: 'id1',
      orderNumber: '260812001',
      phoneNumber: '0176 1234567',
      etaMinutes: 30,
      etaSetAt: new Date(Date.now() - 20 * 60_000),
      save: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it('двигает обещание, сохраняет и шлёт гостю WhatsApp', async () => {
    const order = makeOrder();
    orderMock.findById.mockResolvedValue(order);

    const res = await applyOrderDelay('id1', 15);

    expect(res.ok).toBe(true);
    expect(res.orderNumber).toBe('260812001');
    // Осталось ~10 мин + 15 задержки.
    expect(res.etaMinutes).toBe(25);
    expect(res.whatsappSent).toBe(true);
    expect(order.save).toHaveBeenCalled();
    expect(order.etaSetAt.getTime()).toBeGreaterThan(Date.now() - 5_000);
    expect(whatsappMock.sendOrderDelayNotification).toHaveBeenCalledWith(
      { phoneNumber: '0176 1234567', orderNumber: '260812001' },
      15
    );
  });

  it('без телефона (чек Lieferando) — время двигается, WhatsApp не шлётся', async () => {
    const order = makeOrder({ phoneNumber: '' });
    orderMock.findById.mockResolvedValue(order);

    const res = await applyOrderDelay('id1', 10);

    expect(res.ok).toBe(true);
    expect(res.whatsappSent).toBe(false);
    expect(order.save).toHaveBeenCalled();
    expect(whatsappMock.sendOrderDelayNotification).not.toHaveBeenCalled();
  });

  it('заказ не найден', async () => {
    orderMock.findById.mockResolvedValue(null);
    const res = await applyOrderDelay('missing', 15);
    expect(res).toEqual({ ok: false, reason: 'not_found', whatsappSent: false });
  });

  it('недопустимая задержка отклоняется до похода в БД', async () => {
    const res = await applyOrderDelay('id1', 3);
    expect(res).toEqual({ ok: false, reason: 'invalid_delay', whatsappSent: false });
    expect(orderMock.findById).not.toHaveBeenCalled();
  });

  it('сбой WhatsApp не ломает сдвиг времени', async () => {
    const order = makeOrder();
    orderMock.findById.mockResolvedValue(order);
    whatsappMock.sendOrderDelayNotification.mockResolvedValue(false);

    const res = await applyOrderDelay('id1', 20);
    expect(res.ok).toBe(true);
    expect(res.whatsappSent).toBe(false);
  });
});
