// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  parseStatusCallback,
  resolveTelegramStatus,
  handleStatusCallbackQuery,
} from '../telegram';

/**
 * Кнопки статуса заказа в Telegram. Корневой баг (вебхук на apex → 308 redirect)
 * исправлен в инфраструктуре. Здесь тестируем логику обработчика callback_query:
 * парсер, маппинг статусов, обновление заказа, всегда-ack, идемпотентность, ошибки.
 */

// --- unit: парсер callback_data ---------------------------------------------

describe('parseStatusCallback', () => {
  it('валидный callback → statusKey + orderId', () => {
    expect(parseStatusCallback('status_ready_260620001')).toEqual({
      statusKey: 'ready',
      orderId: '260620001',
    });
    expect(parseStatusCallback('status_preparing_260620001')?.statusKey).toBe('preparing');
  });

  it('orderId с дополнительными символами/подчёркиваниями сохраняется целиком', () => {
    expect(parseStatusCallback('status_cancelled_2606_2000_1')).toEqual({
      statusKey: 'cancelled',
      orderId: '2606_2000_1',
    });
  });

  it('невалидные/чужие callback_data → null', () => {
    expect(parseStatusCallback('other_ready_1')).toBeNull();
    expect(parseStatusCallback('status_')).toBeNull();
    expect(parseStatusCallback('status_ready')).toBeNull();
    expect(parseStatusCallback('status__123')).toBeNull();
    expect(parseStatusCallback(undefined)).toBeNull();
    expect(parseStatusCallback(123 as any)).toBeNull();
  });
});

describe('resolveTelegramStatus', () => {
  it('известные ключи → внутренний статус', () => {
    expect(resolveTelegramStatus('ready')).toBe('ready_for_delivery');
    expect(resolveTelegramStatus('preparing')).toBe('preparing');
    expect(resolveTelegramStatus('delivering')).toBe('delivering');
    expect(resolveTelegramStatus('completed')).toBe('completed');
    expect(resolveTelegramStatus('cancelled')).toBe('cancelled');
  });
  it('неизвестный ключ → null', () => {
    expect(resolveTelegramStatus('bogus')).toBeNull();
  });
});

// --- integration: handleStatusCallbackQuery с мок-Telegram -------------------

const makeOrder = (status = 'new') => ({
  orderNumber: '260620001',
  status,
  phoneNumber: '+49123',
  statusUpdates: [] as any[],
  save: vi.fn(async function (this: any) {
    return this;
  }),
});

const makeDeps = (order: any, over: Record<string, any> = {}) => ({
  answerCallbackQuery: vi.fn(async () => ({})),
  findOrder: vi.fn(async () => order),
  editMessage: vi.fn(async () => {}),
  onStatusChanged: vi.fn(),
  log: vi.fn(),
  ...over,
});

const cbq = (data: string, over: Record<string, any> = {}) => ({
  id: 'cb1',
  data,
  message: { message_id: 555 },
  ...over,
});

describe('handleStatusCallbackQuery', () => {
  it('валидный клик: статус меняется, ack один раз, editMessage и onStatusChanged вызваны', async () => {
    const order = makeOrder('new');
    const deps = makeDeps(order);
    const res = await handleStatusCallbackQuery(cbq('status_ready_260620001'), deps);

    expect(order.status).toBe('ready_for_delivery');
    expect(order.save).toHaveBeenCalledTimes(1);
    expect(order.statusUpdates).toHaveLength(1);
    expect(deps.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(deps.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.objectContaining({ text: expect.stringContaining('ready_for_delivery') }));
    expect(deps.editMessage).toHaveBeenCalledWith(555, 'ready_for_delivery', '260620001', order);
    expect(deps.onStatusChanged).toHaveBeenCalledWith(order, 'ready_for_delivery');
    expect(res).toMatchObject({ handled: true, status: 'ready_for_delivery', reason: 'updated' });
  });

  it('идемпотентность: тот же статус → без save, спокойный ack', async () => {
    const order = makeOrder('ready_for_delivery');
    const deps = makeDeps(order);
    const res = await handleStatusCallbackQuery(cbq('status_ready_260620001'), deps);

    expect(order.save).not.toHaveBeenCalled();
    expect(deps.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ handled: true, reason: 'unchanged' });
  });

  it('заказ не найден → ack-alert, без save', async () => {
    const deps = makeDeps(null);
    const res = await handleStatusCallbackQuery(cbq('status_ready_999'), deps);
    expect(deps.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.objectContaining({ show_alert: true }));
    expect(res).toMatchObject({ handled: false, reason: 'order_not_found' });
  });

  it('неизвестный статус → ack-alert', async () => {
    const deps = makeDeps(makeOrder());
    const res = await handleStatusCallbackQuery(cbq('status_bogus_1'), deps);
    expect(deps.findOrder).not.toHaveBeenCalled();
    expect(res).toMatchObject({ handled: false, reason: 'invalid_status' });
  });

  it('чужой callback → тихий ack, не обрабатываем', async () => {
    const deps = makeDeps(makeOrder());
    const res = await handleStatusCallbackQuery(cbq('menu_open'), deps);
    expect(deps.answerCallbackQuery).toHaveBeenCalledWith('cb1', undefined);
    expect(res).toMatchObject({ handled: false, reason: 'not_status_callback' });
  });

  it('ошибка save → ack-alert, editMessage НЕ вызывается, нет зависания', async () => {
    const order = makeOrder('new');
    order.save = vi.fn(async () => {
      throw new Error('DB down');
    });
    const deps = makeDeps(order);
    const res = await handleStatusCallbackQuery(cbq('status_ready_260620001'), deps);
    expect(deps.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.objectContaining({ show_alert: true }));
    expect(deps.editMessage).not.toHaveBeenCalled();
    expect(res).toMatchObject({ handled: false, reason: 'save_error' });
  });

  it('ошибка Telegram answerCallbackQuery не ломает обработку (статус всё равно сохранён)', async () => {
    const order = makeOrder('new');
    const deps = makeDeps(order, {
      answerCallbackQuery: vi.fn(async () => {
        throw new Error('Telegram API error');
      }),
    });
    const res = await handleStatusCallbackQuery(cbq('status_preparing_260620001'), deps);
    expect(order.save).toHaveBeenCalledTimes(1);
    expect(order.status).toBe('preparing');
    expect(res).toMatchObject({ handled: true, status: 'preparing' });
  });

  it('onStatusChanged ОЖИДАЕТСЯ (await): медленный побочный эффект (начисление баллов) завершается до возврата — критично для serverless', async () => {
    // Регрессия: раньше onStatusChanged вызывался без await, и на serverless
    // функция замораживалась до начисления баллов по статусу из Telegram.
    const order = makeOrder('delivering');
    let sideEffectDone = false;
    const deps = makeDeps(order, {
      onStatusChanged: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 10));
        sideEffectDone = true; // имитация завершённого начисления баллов
      }),
    });

    const res = await handleStatusCallbackQuery(cbq('status_completed_260620001'), deps);

    expect(order.status).toBe('completed');
    expect(deps.onStatusChanged).toHaveBeenCalledWith(order, 'completed');
    expect(sideEffectDone).toBe(true); // дождались побочного эффекта
    expect(res).toMatchObject({ handled: true, status: 'completed' });
  });

  it('callback без message → статус меняется, editMessage пропущен', async () => {
    const order = makeOrder('new');
    const deps = makeDeps(order);
    const res = await handleStatusCallbackQuery(cbq('status_delivering_260620001', { message: undefined }), deps);
    expect(order.status).toBe('delivering');
    expect(deps.editMessage).not.toHaveBeenCalled();
    expect(res).toMatchObject({ handled: true, status: 'delivering' });
  });
});
