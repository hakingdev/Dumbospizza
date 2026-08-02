// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  parseReprintCallback,
  parseStatusCallback,
  handleReprintCallbackQuery,
} from '../telegram';

/**
 * Кнопка «🖨 Чек ещё раз» в Telegram-сообщении заказа. Печатает агент на
 * кассовом ПК, сервер только ставит задание в очередь — поэтому оператору
 * отвечаем «в очереди», а не «напечатано».
 */

describe('parseReprintCallback', () => {
  it('валидный callback → номер заказа', () => {
    expect(parseReprintCallback('reprint_260731002')).toEqual({ orderNumber: '260731002' });
  });

  it('чужие/пустые callback_data → null', () => {
    expect(parseReprintCallback('status_ready_260731002')).toBeNull();
    expect(parseReprintCallback('reprint_')).toBeNull();
    expect(parseReprintCallback(undefined)).toBeNull();
    expect(parseReprintCallback(42 as any)).toBeNull();
  });

  it('кнопки статуса и печати не пересекаются (разводка по префиксу)', () => {
    expect(parseStatusCallback('reprint_260731002')).toBeNull();
    expect(parseReprintCallback('status_cancelled_260731002')).toBeNull();
  });
});

const makeOrder = () => ({ _id: 'o1', orderNumber: '260731002' });

const makeDeps = (over: Record<string, any> = {}) => ({
  answerCallbackQuery: vi.fn(async () => ({})),
  findOrder: vi.fn(async () => makeOrder()),
  requestReprint: vi.fn(async () => ({ _id: 'o1', kitchenPrintSeq: 1 })),
  log: vi.fn(),
  ...over,
});

const cbq = (data: string) => ({ id: 'cb1', data, message: { message_id: 555 } });

describe('handleReprintCallbackQuery', () => {
  it('клик ставит чек в очередь по внутреннему id заказа и подтверждает оператору', async () => {
    const deps = makeDeps();
    const res = await handleReprintCallbackQuery(cbq('reprint_260731002'), deps);

    expect(deps.findOrder).toHaveBeenCalledWith('260731002');
    expect(deps.requestReprint).toHaveBeenCalledWith('o1'); // не orderNumber
    expect(deps.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(deps.answerCallbackQuery).toHaveBeenCalledWith(
      'cb1',
      expect.objectContaining({ text: expect.stringContaining('в очереди') })
    );
    expect(res).toMatchObject({ handled: true, reason: 'queued' });
  });

  it('непечатаемый заказ (не подтверждена оплата) → alert, без молчания', async () => {
    const deps = makeDeps({ requestReprint: vi.fn(async () => null) });
    const res = await handleReprintCallbackQuery(cbq('reprint_260731002'), deps);

    expect(deps.answerCallbackQuery).toHaveBeenCalledWith(
      'cb1',
      expect.objectContaining({ show_alert: true })
    );
    expect(res).toMatchObject({ handled: false, reason: 'rejected' });
  });

  it('заказ не найден → alert, очередь не трогаем', async () => {
    const deps = makeDeps({ findOrder: vi.fn(async () => null) });
    const res = await handleReprintCallbackQuery(cbq('reprint_999'), deps);

    expect(deps.requestReprint).not.toHaveBeenCalled();
    expect(res).toMatchObject({ handled: false, reason: 'order_not_found' });
  });

  it('падение очереди печати не оставляет кнопку в вечном loading', async () => {
    const deps = makeDeps({
      requestReprint: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    const res = await handleReprintCallbackQuery(cbq('reprint_260731002'), deps);

    expect(deps.answerCallbackQuery).toHaveBeenCalledTimes(1); // ack всё равно ушёл
    expect(res.handled).toBe(false);
  });

  it('чужой callback → тихий ack, ничего не делаем', async () => {
    const deps = makeDeps();
    const res = await handleReprintCallbackQuery(cbq('status_ready_260731002'), deps);

    expect(deps.findOrder).not.toHaveBeenCalled();
    expect(deps.requestReprint).not.toHaveBeenCalled();
    expect(res).toMatchObject({ handled: false, reason: 'not_reprint_callback' });
  });
});
