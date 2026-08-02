// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { parseEtaCallback, handleEtaCallbackQuery, ETA_PRESETS } from '../telegram';

/**
 * Кнопка «⏱ Время готовности» в Telegram: оператор выбирает пресет, клиенту
 * уходит WhatsApp через Twilio. Тестируем парсер callback_data и обработчик —
 * всегда-ack, идемпотентность (не слать платное сообщение дважды), честный
 * ответ оператору при недоставке.
 */

// --- unit: парсер callback_data ---------------------------------------------

describe('parseEtaCallback', () => {
  it('меню и возврат', () => {
    expect(parseEtaCallback('eta_menu_260620001')).toEqual({
      action: 'menu',
      orderId: '260620001',
    });
    expect(parseEtaCallback('eta_back_260620001')).toEqual({
      action: 'back',
      orderId: '260620001',
    });
  });

  it('выбор пресета → минуты + orderId', () => {
    expect(parseEtaCallback('eta_set_30_260620001')).toEqual({
      action: 'set',
      minutes: 30,
      orderId: '260620001',
    });
    expect(parseEtaCallback('eta_set_120_260620001')).toMatchObject({ minutes: 120 });
  });

  it('все пресеты клавиатуры разбираются обратно', () => {
    for (const m of ETA_PRESETS) {
      expect(parseEtaCallback(`eta_set_${m}_260620001`)).toEqual({
        action: 'set',
        minutes: m,
        orderId: '260620001',
      });
    }
  });

  it('orderId с подчёркиваниями сохраняется целиком', () => {
    expect(parseEtaCallback('eta_set_45_2606_2000_1')).toEqual({
      action: 'set',
      minutes: 45,
      orderId: '2606_2000_1',
    });
    expect(parseEtaCallback('eta_menu_2606_2000_1')?.orderId).toBe('2606_2000_1');
  });

  it('мусор и чужие callback_data → null', () => {
    expect(parseEtaCallback('status_ready_1')).toBeNull();
    expect(parseEtaCallback('eta_')).toBeNull();
    expect(parseEtaCallback('eta_menu_')).toBeNull();
    expect(parseEtaCallback('eta_set_30')).toBeNull();
    expect(parseEtaCallback('eta_set_abc_1')).toBeNull();
    expect(parseEtaCallback('eta_set_0_1')).toBeNull();
    expect(parseEtaCallback('eta_set_-5_1')).toBeNull();
    expect(parseEtaCallback('eta_set_9999_1')).toBeNull();
    expect(parseEtaCallback('eta_set_30.5_1')).toBeNull();
    expect(parseEtaCallback('eta_bogus_1')).toBeNull();
    expect(parseEtaCallback(undefined)).toBeNull();
    expect(parseEtaCallback(123 as any)).toBeNull();
  });
});

// --- integration: handleEtaCallbackQuery с мок-Telegram ----------------------

const makeOrder = (over: Record<string, any> = {}): any => ({
  orderNumber: '260620001',
  status: 'new',
  phoneNumber: '+49123',
  save: vi.fn(async function (this: any) {
    return this;
  }),
  ...over,
});

const makeDeps = (order: any, over: Record<string, any> = {}) => ({
  answerCallbackQuery: vi.fn(async () => ({})),
  findOrder: vi.fn(async () => order),
  showEtaMenu: vi.fn(async () => {}),
  showMainKeyboard: vi.fn(async () => {}),
  refreshMessage: vi.fn(async () => {}),
  notifyCustomer: vi.fn(async () => true),
  log: vi.fn(),
  ...over,
});

const cbq = (data: string, over: Record<string, any> = {}) => ({
  id: 'cb1',
  data,
  message: { message_id: 555 },
  ...over,
});

describe('handleEtaCallbackQuery', () => {
  it('клик по «⏱ Время готовности» показывает пресеты, БД не трогает', async () => {
    const deps = makeDeps(makeOrder());
    const res = await handleEtaCallbackQuery(cbq('eta_menu_260620001'), deps);

    expect(deps.showEtaMenu).toHaveBeenCalledWith(555, '260620001');
    expect(deps.findOrder).not.toHaveBeenCalled();
    expect(deps.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ handled: true, reason: 'menu_shown' });
  });

  it('«Назад» возвращает основную клавиатуру', async () => {
    const deps = makeDeps(makeOrder());
    const res = await handleEtaCallbackQuery(cbq('eta_back_260620001'), deps);

    expect(deps.showMainKeyboard).toHaveBeenCalledWith(555, '260620001');
    expect(deps.notifyCustomer).not.toHaveBeenCalled();
    expect(res).toMatchObject({ handled: true, reason: 'menu_closed' });
  });

  it('выбор пресета: сохраняем, шлём клиенту, подтверждаем оператору, перерисовываем', async () => {
    const order = makeOrder();
    const deps = makeDeps(order);
    const res = await handleEtaCallbackQuery(cbq('eta_set_30_260620001'), deps);

    expect(order.etaMinutes).toBe(30);
    expect(order.etaSetAt).toBeInstanceOf(Date);
    expect(order.save).toHaveBeenCalledTimes(1);
    expect(deps.notifyCustomer).toHaveBeenCalledWith(order, 30);
    expect(deps.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(deps.answerCallbackQuery).toHaveBeenCalledWith(
      'cb1',
      expect.objectContaining({ text: expect.stringContaining('отправлено') })
    );
    expect(deps.refreshMessage).toHaveBeenCalledWith(555, order);
    expect(res).toMatchObject({ handled: true, minutes: 30, reason: 'sent' });
  });

  it('идемпотентность: то же время → без записи и без второго платного сообщения', async () => {
    const order = makeOrder({ etaMinutes: 45 });
    const deps = makeDeps(order);
    const res = await handleEtaCallbackQuery(cbq('eta_set_45_260620001'), deps);

    expect(order.save).not.toHaveBeenCalled();
    expect(deps.notifyCustomer).not.toHaveBeenCalled();
    expect(deps.showMainKeyboard).toHaveBeenCalledWith(555, '260620001');
    expect(res).toMatchObject({ handled: true, minutes: 45, reason: 'unchanged' });
  });

  it('изменение времени поверх прежнего → шлём заново', async () => {
    const order = makeOrder({ etaMinutes: 30 });
    const deps = makeDeps(order);
    const res = await handleEtaCallbackQuery(cbq('eta_set_60_260620001'), deps);

    expect(order.etaMinutes).toBe(60);
    expect(deps.notifyCustomer).toHaveBeenCalledWith(order, 60);
    expect(res).toMatchObject({ handled: true, minutes: 60, reason: 'sent' });
  });

  it('WhatsApp не доставлен → время сохранено, оператор видит alert', async () => {
    const order = makeOrder();
    const deps = makeDeps(order, { notifyCustomer: vi.fn(async () => false) });
    const res = await handleEtaCallbackQuery(cbq('eta_set_30_260620001'), deps);

    expect(order.save).toHaveBeenCalledTimes(1);
    expect(deps.answerCallbackQuery).toHaveBeenCalledWith(
      'cb1',
      expect.objectContaining({ show_alert: true })
    );
    expect(res).toMatchObject({ handled: true, reason: 'send_failed' });
  });

  it('исключение при отправке не ломает обработку (нет вечного loading)', async () => {
    const order = makeOrder();
    const deps = makeDeps(order, {
      notifyCustomer: vi.fn(async () => {
        throw new Error('Twilio down');
      }),
    });
    const res = await handleEtaCallbackQuery(cbq('eta_set_90_260620001'), deps);

    expect(order.etaMinutes).toBe(90);
    expect(deps.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ handled: true, reason: 'send_failed' });
  });

  it('ошибка save → клиенту ничего не шлём', async () => {
    const order = makeOrder({
      save: vi.fn(async () => {
        throw new Error('DB down');
      }),
    });
    const deps = makeDeps(order);
    const res = await handleEtaCallbackQuery(cbq('eta_set_30_260620001'), deps);

    expect(deps.notifyCustomer).not.toHaveBeenCalled();
    expect(deps.refreshMessage).not.toHaveBeenCalled();
    expect(deps.answerCallbackQuery).toHaveBeenCalledWith(
      'cb1',
      expect.objectContaining({ show_alert: true })
    );
    expect(res).toMatchObject({ handled: false, reason: 'save_error' });
  });

  it('заказ не найден → alert, ничего не шлём', async () => {
    const deps = makeDeps(null);
    const res = await handleEtaCallbackQuery(cbq('eta_set_30_999'), deps);

    expect(deps.notifyCustomer).not.toHaveBeenCalled();
    expect(res).toMatchObject({ handled: false, reason: 'order_not_found' });
  });

  it('ошибка Telegram answerCallbackQuery не мешает отправке клиенту', async () => {
    const order = makeOrder();
    const deps = makeDeps(order, {
      answerCallbackQuery: vi.fn(async () => {
        throw new Error('Telegram API error');
      }),
    });
    const res = await handleEtaCallbackQuery(cbq('eta_set_30_260620001'), deps);

    expect(deps.notifyCustomer).toHaveBeenCalledWith(order, 30);
    expect(res).toMatchObject({ handled: true, reason: 'sent' });
  });

  it('чужой callback → тихий ack, не обрабатываем', async () => {
    const deps = makeDeps(makeOrder());
    const res = await handleEtaCallbackQuery(cbq('status_ready_260620001'), deps);

    expect(deps.answerCallbackQuery).toHaveBeenCalledWith('cb1', undefined);
    expect(deps.findOrder).not.toHaveBeenCalled();
    expect(res).toMatchObject({ handled: false, reason: 'not_eta_callback' });
  });

  it('callback без message → время всё равно уходит клиенту, перерисовка пропущена', async () => {
    const order = makeOrder();
    const deps = makeDeps(order);
    const res = await handleEtaCallbackQuery(
      cbq('eta_set_30_260620001', { message: undefined }),
      deps
    );

    expect(deps.notifyCustomer).toHaveBeenCalledWith(order, 30);
    expect(deps.refreshMessage).not.toHaveBeenCalled();
    expect(res).toMatchObject({ handled: true, reason: 'sent' });
  });
});
