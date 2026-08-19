// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../settings', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

import { getSetting, setSetting } from '../settings';
import {
  claimLieferandoCommand,
  readLieferandoState,
  reportLieferandoResult,
  requestLieferandoToggle,
  EMPTY_LIEFERANDO_STATE,
  LIEFERANDO_MAKILOVE_KEY,
  RUNNING_TTL_MS,
} from '../lieferando-makilove';

/**
 * Очередь команд «выключить/включить MakiLove на Lieferando»: бот пишет команду,
 * агент на кассовом ПК забирает её поллингом и отчитывается о выполнении.
 * Тестируем: устойчивость к мусору, постановку, забор (в т.ч. протухший running)
 * и отчёт.
 */

const mGet = getSetting as unknown as ReturnType<typeof vi.fn>;
const mSet = setSetting as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

const NOW = new Date('2026-08-19T18:00:00Z');

const written = () => mSet.mock.calls.at(-1)![1];

describe('readLieferandoState', () => {
  it('мусор/пусто → безопасное состояние', () => {
    expect(readLieferandoState(null)).toEqual(EMPTY_LIEFERANDO_STATE);
    expect(readLieferandoState('bogus')).toEqual(EMPTY_LIEFERANDO_STATE);
    expect(readLieferandoState({ command: { id: 1, action: 'zzz' } })).toEqual(
      EMPTY_LIEFERANDO_STATE
    );
  });

  it('валидные поля проходят', () => {
    const s = readLieferandoState({
      command: { id: 'a', action: 'off', requestedAt: 'x' },
      itemsState: 'off',
      agentSeenAt: '2026-08-19T17:59:00Z',
    });
    expect(s.command?.action).toBe('off');
    expect(s.itemsState).toBe('off');
    expect(s.agentSeenAt).toBe('2026-08-19T17:59:00Z');
  });
});

describe('requestLieferandoToggle', () => {
  it('ставит команду, повторное нажатие перезаписывает', async () => {
    mGet.mockResolvedValue({
      command: { id: 'old', action: 'off', requestedAt: 'x' },
      itemsState: 'on',
    });
    await requestLieferandoToggle('on', NOW);
    const value = written();
    expect(mSet).toHaveBeenCalledWith(LIEFERANDO_MAKILOVE_KEY, expect.anything());
    expect(value.command.action).toBe('on');
    expect(value.command.id).not.toBe('old');
    expect(value.command.requestedAt).toBe(NOW.toISOString());
    expect(value.itemsState).toBe('on'); // остальное не тронуто
  });
});

describe('claimLieferandoCommand', () => {
  it('нет команды → null, но heartbeat обновлён', async () => {
    mGet.mockResolvedValue(null);
    const { command } = await claimLieferandoCommand('pc-1', NOW);
    expect(command).toBeNull();
    expect(written().agentSeenAt).toBe(NOW.toISOString());
  });

  it('команда → отдаётся и переходит в running', async () => {
    mGet.mockResolvedValue({ command: { id: 'c1', action: 'off', requestedAt: 'x' } });
    const { command } = await claimLieferandoCommand('pc-1', NOW);
    expect(command?.id).toBe('c1');
    const value = written();
    expect(value.command).toBeNull();
    expect(value.running).toMatchObject({ id: 'c1', action: 'off', agentId: 'pc-1' });
  });

  it('свежий running НЕ отдаётся заново', async () => {
    mGet.mockResolvedValue({
      running: {
        id: 'c1',
        action: 'off',
        requestedAt: 'x',
        startedAt: new Date(NOW.getTime() - 60_000).toISOString(),
        agentId: 'pc-1',
      },
    });
    const { command } = await claimLieferandoCommand('pc-1', NOW);
    expect(command).toBeNull();
  });

  it('протухший running отдаётся заново (агент перезапустился)', async () => {
    mGet.mockResolvedValue({
      running: {
        id: 'c1',
        action: 'on',
        requestedAt: 'x',
        startedAt: new Date(NOW.getTime() - RUNNING_TTL_MS - 1000).toISOString(),
        agentId: 'pc-1',
      },
    });
    const { command } = await claimLieferandoCommand('pc-2', NOW);
    expect(command?.id).toBe('c1');
    expect(written().running.agentId).toBe('pc-2');
  });
});

describe('reportLieferandoResult', () => {
  it('успех off → running снят, itemsState=off, lastResult записан', async () => {
    mGet.mockResolvedValue({
      running: { id: 'c1', action: 'off', requestedAt: 'x', startedAt: 'y', agentId: 'pc-1' },
      itemsState: 'on',
    });
    await reportLieferandoResult(
      { id: 'c1', action: 'off', ok: true, count: 46, failed: 0, message: '' },
      NOW
    );
    const value = written();
    expect(value.running).toBeNull();
    expect(value.itemsState).toBe('off');
    expect(value.lastResult).toMatchObject({ id: 'c1', ok: true, count: 46 });
    expect(value.lastResult.finishedAt).toBe(NOW.toISOString());
  });

  it('провал → itemsState НЕ меняется', async () => {
    mGet.mockResolvedValue({ itemsState: 'on' });
    await reportLieferandoResult(
      { id: 'c9', action: 'off', ok: false, count: 0, failed: 0, message: 'сессия истекла' },
      NOW
    );
    expect(written().itemsState).toBe('on');
  });

  it('отчёт о чужом id не снимает текущий running', async () => {
    mGet.mockResolvedValue({
      running: { id: 'c2', action: 'on', requestedAt: 'x', startedAt: 'y', agentId: 'pc-1' },
    });
    await reportLieferandoResult(
      { id: 'c1', action: 'off', ok: true, count: 3, failed: 0, message: '' },
      NOW
    );
    expect(written().running?.id).toBe('c2');
  });
});
