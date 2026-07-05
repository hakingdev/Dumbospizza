// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Мокаем слой настроек: applyBlockAction ходит в getSetting/setSetting.
vi.mock('../settings', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

import { getSetting, setSetting } from '../settings';
import {
  parseControlAction,
  parseCommand,
  buildPanelText,
  applyBlockAction,
  handleControlUpdate,
  CTRL_BLOCK_30,
  CTRL_BLOCK_60,
  CTRL_UNBLOCK,
  CTRL_STATUS,
} from '../telegram-control';

/**
 * Служебный stop-бот: блокировка приёма заказов на 30/60 мин.
 * Пишет в единый storeSettings.ordersBlockedUntil (тот же, что админка и /api/orders).
 * Тестируем: парсеры, рендер панели, read-modify-write, ядро обработки update с гейтом по чату.
 */

const mGet = getSetting as unknown as ReturnType<typeof vi.fn>;
const mSet = setSetting as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

// --- unit: парсеры -----------------------------------------------------------

describe('parseControlAction', () => {
  it('кнопки панели → действия', () => {
    expect(parseControlAction(CTRL_BLOCK_30)).toEqual({ type: 'block', minutes: 30 });
    expect(parseControlAction(CTRL_BLOCK_60)).toEqual({ type: 'block', minutes: 60 });
    expect(parseControlAction(CTRL_UNBLOCK)).toEqual({ type: 'unblock' });
    expect(parseControlAction(CTRL_STATUS)).toEqual({ type: 'status' });
  });
  it('чужие/пустые callback_data → null', () => {
    expect(parseControlAction('status_ready_1')).toBeNull();
    expect(parseControlAction('')).toBeNull();
    expect(parseControlAction(undefined)).toBeNull();
  });
});

describe('parseCommand', () => {
  it('/panel и /start (в т.ч. @bot) → panel', () => {
    expect(parseCommand('/panel')).toBe('panel');
    expect(parseCommand('/start')).toBe('panel');
    expect(parseCommand('/panel@dumbosstoporder_bot')).toBe('panel');
    expect(parseCommand('  /PANEL ')).toBe('panel');
  });
  it('прочее → null', () => {
    expect(parseCommand('привет')).toBeNull();
    expect(parseCommand('/blockieren')).toBeNull();
    expect(parseCommand(undefined)).toBeNull();
  });
});

// --- unit: рендер панели -----------------------------------------------------

describe('buildPanelText', () => {
  const now = new Date('2026-07-05T17:00:00.000Z');
  it('активная блокировка → ЗАБЛОКИРОВАН', () => {
    const until = new Date('2026-07-05T17:30:00.000Z').toISOString();
    expect(buildPanelText(until, now)).toContain('ЗАБЛОКИРОВАН');
  });
  it('пусто → АКТИВЕН', () => {
    expect(buildPanelText('', now)).toContain('АКТИВЕН');
  });
  it('истёкшая блокировка → АКТИВЕН', () => {
    const past = new Date('2026-07-05T16:00:00.000Z').toISOString();
    expect(buildPanelText(past, now)).toContain('АКТИВЕН');
  });
});

// --- unit: read-modify-write -------------------------------------------------

describe('applyBlockAction', () => {
  const now = new Date('2026-07-05T17:00:00.000Z');
  const until30 = new Date('2026-07-05T17:30:00.000Z').toISOString();

  it('block: ставит ordersBlockedUntil, ОСТАЛЬНЫЕ настройки сохраняет', async () => {
    mGet.mockResolvedValue({ storeName: 'Dumbo', ordersBlockedReason: 'x', ordersBlockedUntil: '' });
    const until = await applyBlockAction({ type: 'block', minutes: 30 }, now);
    expect(until).toBe(until30);
    expect(mSet).toHaveBeenCalledWith('storeSettings', {
      storeName: 'Dumbo',
      ordersBlockedReason: 'x',
      ordersBlockedUntil: until30,
    });
  });

  it('unblock: чистит ordersBlockedUntil, прочее не трогает', async () => {
    mGet.mockResolvedValue({ storeName: 'Dumbo', ordersBlockedUntil: 'sometime' });
    const until = await applyBlockAction({ type: 'unblock' });
    expect(until).toBe('');
    expect(mSet).toHaveBeenCalledWith('storeSettings', { storeName: 'Dumbo', ordersBlockedUntil: '' });
  });

  it('status: НЕ пишет, возвращает текущее значение', async () => {
    mGet.mockResolvedValue({ ordersBlockedUntil: 'abc' });
    const until = await applyBlockAction({ type: 'status' });
    expect(until).toBe('abc');
    expect(mSet).not.toHaveBeenCalled();
  });
});

// --- integration: handleControlUpdate ---------------------------------------

const ALLOWED = '-100999';

const makeDeps = (over: Record<string, any> = {}) => ({
  answerCallbackQuery: vi.fn(async () => ({})),
  editPanel: vi.fn(async () => ({})),
  sendPanel: vi.fn(async () => ({})),
  getBlockState: vi.fn(async () => ({ ordersBlockedUntil: '' })),
  applyAction: vi.fn(async (a: any) => (a.type === 'block' ? '2026-07-05T17:30:00.000Z' : '')),
  allowedChatId: ALLOWED,
  log: vi.fn(),
  ...over,
});

const cbUpdate = (data: string, chatId: number | string = -100999, over: Record<string, any> = {}) => ({
  callback_query: { id: 'cb1', data, message: { message_id: 42, chat: { id: chatId } }, ...over },
});

describe('handleControlUpdate', () => {
  it('блок 30 из своей группы: applyAction, ack, editPanel', async () => {
    const deps = makeDeps();
    const res = await handleControlUpdate(cbUpdate(CTRL_BLOCK_30), deps);
    expect(deps.applyAction).toHaveBeenCalledWith({ type: 'block', minutes: 30 });
    expect(deps.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(deps.editPanel).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ handled: true, reason: 'blocked' });
  });

  it('чужой чат: отклоняем, applyAction НЕ вызывается', async () => {
    const deps = makeDeps();
    const res = await handleControlUpdate(cbUpdate(CTRL_BLOCK_30, 12345), deps);
    expect(deps.applyAction).not.toHaveBeenCalled();
    expect(deps.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ handled: false, reason: 'wrong_chat' });
  });

  it('чужой callback_data (кнопка бота заказов): not_ours, тихий ack', async () => {
    const deps = makeDeps();
    const res = await handleControlUpdate(cbUpdate('status_ready_1'), deps);
    expect(deps.applyAction).not.toHaveBeenCalled();
    expect(res).toEqual({ handled: false, reason: 'not_ours' });
  });

  it('разблокировка → unblocked', async () => {
    const deps = makeDeps();
    const res = await handleControlUpdate(cbUpdate(CTRL_UNBLOCK), deps);
    expect(deps.applyAction).toHaveBeenCalledWith({ type: 'unblock' });
    expect(res).toEqual({ handled: true, reason: 'unblocked' });
  });

  it('статус → status, панель перерисована', async () => {
    const deps = makeDeps({ applyAction: vi.fn(async () => '') });
    const res = await handleControlUpdate(cbUpdate(CTRL_STATUS), deps);
    expect(res).toEqual({ handled: true, reason: 'status' });
    expect(deps.editPanel).toHaveBeenCalledTimes(1);
  });

  it('applyAction падает: error, ack-предупреждение, editPanel НЕ вызывается', async () => {
    const deps = makeDeps({
      applyAction: vi.fn(async () => {
        throw new Error('DB down');
      }),
    });
    const res = await handleControlUpdate(cbUpdate(CTRL_BLOCK_60), deps);
    expect(deps.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(deps.editPanel).not.toHaveBeenCalled();
    expect(res).toEqual({ handled: false, reason: 'error' });
  });

  it('ошибка answerCallbackQuery не ломает обработку', async () => {
    const deps = makeDeps({
      answerCallbackQuery: vi.fn(async () => {
        throw new Error('Telegram API error');
      }),
    });
    const res = await handleControlUpdate(cbUpdate(CTRL_BLOCK_30), deps);
    expect(res).toEqual({ handled: true, reason: 'blocked' });
    expect(deps.editPanel).toHaveBeenCalledTimes(1);
  });

  it('/panel из своей группы: sendPanel', async () => {
    const deps = makeDeps();
    const res = await handleControlUpdate(
      { message: { text: '/panel@dumbosstoporder_bot', chat: { id: -100999 } } },
      deps
    );
    expect(deps.sendPanel).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ handled: true, reason: 'panel' });
  });

  it('/panel из чужого чата: wrong_chat, без sendPanel', async () => {
    const deps = makeDeps();
    const res = await handleControlUpdate({ message: { text: '/panel', chat: { id: 5 } } }, deps);
    expect(deps.sendPanel).not.toHaveBeenCalled();
    expect(res).toEqual({ handled: false, reason: 'wrong_chat' });
  });

  it('обычное сообщение (не команда): not_ours', async () => {
    const deps = makeDeps();
    const res = await handleControlUpdate(
      { message: { text: 'привет', chat: { id: -100999 } } },
      deps
    );
    expect(res).toEqual({ handled: false, reason: 'not_ours' });
  });
});
