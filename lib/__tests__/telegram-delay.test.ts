// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { parseDelayCallback, handleDelayCallbackQuery } from '../telegram';
import { ORDER_DELAY_CHOICES } from '../orders/delay';

/**
 * Кнопка «⏳ Продлить» в Telegram: оператор выбирает «+N мин», обещание
 * сдвигается (lib/orders/delay.ts) и клиенту уходит WhatsApp по готовому
 * Twilio-шаблону задержки. Тестируем парсер callback_data и обработчик —
 * всегда-ack, честный alert при недоставке WhatsApp.
 */

// --- unit: парсер callback_data ---------------------------------------------

describe('parseDelayCallback', () => {
  it('меню и возврат', () => {
    expect(parseDelayCallback('delay_menu_260813006')).toEqual({
      action: 'menu',
      orderId: '260813006',
    });
    expect(parseDelayCallback('delay_back_260813006')).toEqual({
      action: 'back',
      orderId: '260813006',
    });
  });

  it('все пресеты клавиатуры разбираются обратно', () => {
    for (const m of ORDER_DELAY_CHOICES) {
      expect(parseDelayCallback(`delay_set_${m}_260813006`)).toEqual({
        action: 'set',
        minutes: m,
        orderId: '260813006',
      });
    }
  });

  it('orderId с подчёркиваниями сохраняется целиком', () => {
    expect(parseDelayCallback('delay_set_15_L_GRCR8J')).toEqual({
      action: 'set',
      minutes: 15,
      orderId: 'L_GRCR8J',
    });
  });

  it('мусор, чужие callback_data и вне диапазона 5…60 → null', () => {
    expect(parseDelayCallback('eta_set_30_1')).toBeNull();
    expect(parseDelayCallback('delay_')).toBeNull();
    expect(parseDelayCallback('delay_menu_')).toBeNull();
    expect(parseDelayCallback('delay_set_15')).toBeNull();
    expect(parseDelayCallback('delay_set_abc_1')).toBeNull();
    expect(parseDelayCallback('delay_set_0_1')).toBeNull();
    expect(parseDelayCallback('delay_set_120_1')).toBeNull();
    expect(parseDelayCallback('delay_set_15.5_1')).toBeNull();
    expect(parseDelayCallback(undefined)).toBeNull();
  });
});

// --- integration: handleDelayCallbackQuery с мок-Telegram --------------------

const makeOrder = (over: Record<string, any> = {}): any => ({
  _id: 'db-id-1',
  orderNumber: '260813006',
  status: 'preparing',
  phoneNumber: '+49123',
  ...over,
});

const makeDeps = (order: any, over: Record<string, any> = {}) => ({
  answerCallbackQuery: vi.fn(async () => ({})),
  findOrder: vi.fn(async () => order),
  applyDelay: vi.fn(async () => ({ ok: true, etaMinutes: 35, whatsappSent: true })),
  showDelayMenu: vi.fn(async () => {}),
  showMainKeyboard: vi.fn(async () => {}),
  refreshMessage: vi.fn(async () => {}),
  log: vi.fn(),
  ...over,
});

const cbq = (data: string, over: Record<string, any> = {}) => ({
  id: 'cb1',
  data,
  message: { message_id: 555 },
  ...over,
});

describe('handleDelayCallbackQuery', () => {
  it('клик по «⏳ Продлить» показывает пресеты, БД не трогает', async () => {
    const deps = makeDeps(makeOrder());
    const res = await handleDelayCallbackQuery(cbq('delay_menu_260813006'), deps);

    expect(deps.showDelayMenu).toHaveBeenCalledWith(555, '260813006');
    expect(deps.findOrder).not.toHaveBeenCalled();
    expect(deps.applyDelay).not.toHaveBeenCalled();
    expect(res).toMatchObject({ handled: true, reason: 'menu_shown' });
  });

  it('«Назад» возвращает основную клавиатуру', async () => {
    const deps = makeDeps(makeOrder());
    const res = await handleDelayCallbackQuery(cbq('delay_back_260813006'), deps);

    expect(deps.showMainKeyboard).toHaveBeenCalledWith(555, '260813006');
    expect(deps.applyDelay).not.toHaveBeenCalled();
    expect(res).toMatchObject({ handled: true, reason: 'menu_closed' });
  });

  it('выбор «+15»: продлеваем по db-id, подтверждаем оператору, перерисовываем', async () => {
    const order = makeOrder();
    const deps = makeDeps(order);
    const res = await handleDelayCallbackQuery(cbq('delay_set_15_260813006'), deps);

    expect(deps.applyDelay).toHaveBeenCalledWith('db-id-1', 15);
    expect(deps.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(deps.answerCallbackQuery).toHaveBeenCalledWith(
      'cb1',
      expect.objectContaining({ text: expect.stringContaining('отправлено') })
    );
    expect(deps.refreshMessage).toHaveBeenCalledWith(555, order);
    expect(res).toMatchObject({ handled: true, minutes: 15, reason: 'sent' });
  });

  it('WhatsApp не доставлен → продление сохранено, оператор видит alert', async () => {
    const deps = makeDeps(makeOrder(), {
      applyDelay: vi.fn(async () => ({ ok: true, etaMinutes: 35, whatsappSent: false })),
    });
    const res = await handleDelayCallbackQuery(cbq('delay_set_10_260813006'), deps);

    expect(deps.answerCallbackQuery).toHaveBeenCalledWith(
      'cb1',
      expect.objectContaining({ show_alert: true, text: expect.stringContaining('НЕ отправлено') })
    );
    expect(res).toMatchObject({ handled: true, minutes: 10, reason: 'send_failed' });
  });

  it('applyDelay упал → alert, сообщение не перерисовываем', async () => {
    const deps = makeDeps(makeOrder(), {
      applyDelay: vi.fn(async () => ({ ok: false, whatsappSent: false })),
    });
    const res = await handleDelayCallbackQuery(cbq('delay_set_20_260813006'), deps);

    expect(deps.answerCallbackQuery).toHaveBeenCalledWith(
      'cb1',
      expect.objectContaining({ show_alert: true })
    );
    expect(deps.refreshMessage).not.toHaveBeenCalled();
    expect(res).toMatchObject({ handled: false, reason: 'apply_error' });
  });

  it('заказ не найден → alert, продление не применяется', async () => {
    const deps = makeDeps(null);
    const res = await handleDelayCallbackQuery(cbq('delay_set_10_999'), deps);

    expect(deps.applyDelay).not.toHaveBeenCalled();
    expect(deps.answerCallbackQuery).toHaveBeenCalledWith(
      'cb1',
      expect.objectContaining({ show_alert: true })
    );
    expect(res).toMatchObject({ handled: false, reason: 'order_not_found' });
  });

  it('чужой callback_data → просто ack, ничего не делаем', async () => {
    const deps = makeDeps(makeOrder());
    const res = await handleDelayCallbackQuery(cbq('status_ready_1'), deps);

    expect(deps.findOrder).not.toHaveBeenCalled();
    expect(res).toMatchObject({ handled: false, reason: 'not_delay_callback' });
  });
});
