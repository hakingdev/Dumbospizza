// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { formatReapplySummary, reapplyIndefiniteStops } from '../menu-stop/reapply';

/**
 * Утреннее перевыключение бессрочного стоп-листа на Lieferando: команды агенту
 * (размер — по одной, позиции — одной со всеми именами), одна сводка в группу,
 * тишина при пустом списке, сбой одной команды не роняет остальные.
 */

const deps = (over: Record<string, any> = {}) => ({
  reconcile: vi.fn(async () => ({
    sizes: [
      { id: 's36', name: '36 cm' },
      { id: 's40', name: '40 cm' },
    ],
    products: [
      { id: 'p1', name: 'Vegan philly' },
      { id: 'p2', name: 'Mac & Cheese' },
    ],
  })),
  queue: vi.fn(async (_action: 'off', _target: unknown) => ({})),
  agentOnline: vi.fn(async () => true),
  send: vi.fn(async (_text: string) => true),
  log: vi.fn(),
  ...over,
});

describe('reapplyIndefiniteStops', () => {
  it('размеры — по команде на каждый, позиции — одной командой; одна сводка', async () => {
    const d = deps();
    const r = await reapplyIndefiniteStops(d);
    expect(d.queue.mock.calls).toEqual([
      ['off', { kind: 'size', label: '36 cm' }],
      ['off', { kind: 'size', label: '40 cm' }],
      ['off', { kind: 'item', names: ['Vegan philly', 'Mac & Cheese'] }],
    ]);
    expect(d.send).toHaveBeenCalledTimes(1);
    const text = d.send.mock.calls[0][0] as string;
    expect(text).toContain('⛔ <b>Бессрочно выключено</b>');
    expect(text).toContain('🍕 Размеры: 36 cm, 40 cm');
    expect(text).toContain('📋 Позиции: Vegan philly, Mac &amp; Cheese'); // HTML-экранирование
    expect(text).toContain('Агент выполнит в фоне');
    expect(r).toEqual({
      sizes: ['36 cm', '40 cm'],
      products: ['Vegan philly', 'Mac & Cheese'],
      queued: 3,
      failed: 0,
      agentOnline: true,
      notified: true,
    });
  });

  it('пустой стоп-лист → ни команд, ни сообщения', async () => {
    const d = deps({ reconcile: vi.fn(async () => ({ sizes: [], products: [] })) });
    const r = await reapplyIndefiniteStops(d);
    expect(d.queue).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
    expect(r).toMatchObject({ queued: 0, notified: false, sizes: [], products: [] });
  });

  it('только позиции → одна item-команда, без строки размеров', async () => {
    const d = deps({
      reconcile: vi.fn(async () => ({ sizes: [], products: [{ id: 'p1', name: 'Vegan philly' }] })),
    });
    await reapplyIndefiniteStops(d);
    expect(d.queue).toHaveBeenCalledTimes(1);
    expect(d.queue).toHaveBeenCalledWith('off', { kind: 'item', names: ['Vegan philly'] });
    expect(d.send.mock.calls[0][0]).not.toContain('🍕 Размеры:');
  });

  it('сбой одной команды считается в failed, остальные ставятся, сводка предупреждает', async () => {
    let n = 0;
    const d = deps({
      queue: vi.fn(async (_action: 'off', _target: unknown) => {
        if (++n === 2) throw new Error('settings down');
        return {};
      }),
    });
    const r = await reapplyIndefiniteStops(d);
    expect(r).toMatchObject({ queued: 2, failed: 1, notified: true });
    expect(d.send.mock.calls[0][0]).toContain('Не удалось поставить команд агенту: 1');
    expect(d.log).toHaveBeenCalled();
  });

  it('агент офлайн → сводка предупреждает; сбой Telegram не роняет результат', async () => {
    const d = deps({
      agentOnline: vi.fn(async () => false),
      send: vi.fn(async (_text: string) => {
        throw new Error('telegram down');
      }),
    });
    const r = await reapplyIndefiniteStops(d);
    expect(r).toMatchObject({ queued: 3, agentOnline: false, notified: false });
    expect(formatReapplySummary(r)).toContain('⚠️ Агент Lieferando не на связи');
  });
});
