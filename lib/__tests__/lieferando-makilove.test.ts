// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../settings', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

import { getSetting, setSetting } from '../settings';
import {
  claimLieferandoCommand,
  describeLieferandoTarget,
  formatLieferandoReport,
  lieferandoReportWanted,
  lieferandoTargetKey,
  readLieferandoState,
  readLieferandoTarget,
  reportLieferandoResult,
  requestLieferandoCommand,
  requestLieferandoToggle,
  EMPTY_LIEFERANDO_STATE,
  LIEFERANDO_MAKILOVE_KEY,
  MAX_QUEUE,
  RUNNING_TTL_MS,
  type LieferandoResult,
  type LieferandoTarget,
} from '../lieferando-makilove';

/**
 * Очередь команд агенту Lieferando: бот ставит команды (MakiLove / размер /
 * позиции), агент забирает их поллингом по одной (FIFO) и отчитывается.
 * Тестируем: совместимое чтение старого формата, постановку без затирания
 * чужих целей, забор (в т.ч. старым агентом и протухший running), отчёт
 * и тексты отчётов в группу.
 */

const mGet = getSetting as unknown as ReturnType<typeof vi.fn>;
const mSet = setSetting as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

const NOW = new Date('2026-11-02T18:00:00Z');

const written = () => mSet.mock.calls.at(-1)![1];

const SIZE_30: LieferandoTarget = { kind: 'size', label: '30 cm' };
const ITEM_HAW: LieferandoTarget = { kind: 'item', names: ['Hawaiian'] };
const MAKI: LieferandoTarget = { kind: 'makilove' };

const cmd = (id: string, action: 'off' | 'on', target: unknown = MAKI) => ({
  id,
  action,
  target,
  requestedAt: 'x',
});

describe('readLieferandoState', () => {
  it('мусор/пусто → безопасное состояние', () => {
    expect(readLieferandoState(null)).toEqual(EMPTY_LIEFERANDO_STATE);
    expect(readLieferandoState('bogus')).toEqual(EMPTY_LIEFERANDO_STATE);
    expect(readLieferandoState({ command: { id: 1, action: 'zzz' } })).toEqual(
      EMPTY_LIEFERANDO_STATE
    );
    expect(readLieferandoState({ commands: 'nope' })).toEqual(EMPTY_LIEFERANDO_STATE);
  });

  it('старый формат (одно поле command без target) → очередь из одной команды MakiLove', () => {
    const s = readLieferandoState({
      command: { id: 'a', action: 'off', requestedAt: 'x' },
      itemsState: 'off',
      agentSeenAt: '2026-11-02T17:59:00Z',
    });
    expect(s.commands).toEqual([{ id: 'a', action: 'off', target: MAKI, requestedAt: 'x' }]);
    expect(s.command?.id).toBe('a'); // панель MakiLove видит её как раньше
    expect(s.itemsState).toBe('off');
    expect(s.agentSeenAt).toBe('2026-11-02T17:59:00Z');
  });

  it('старое command + новая очередь: без дублей по id, старое первым', () => {
    const s = readLieferandoState({
      command: cmd('a', 'off'),
      commands: [cmd('a', 'off'), cmd('b', 'off', SIZE_30)],
    });
    expect(s.commands.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('команда с битой целью выбрасывается, остальные остаются', () => {
    const s = readLieferandoState({
      commands: [cmd('a', 'off', { kind: 'size' }), cmd('b', 'on', { kind: 'item', names: [] }), cmd('c', 'on', ITEM_HAW)],
    });
    expect(s.commands.map((c) => c.id)).toEqual(['c']);
  });

  it('command (вычисляемое) = первая команда MakiLove, а не голова очереди', () => {
    const s = readLieferandoState({
      commands: [cmd('s', 'off', SIZE_30), cmd('m', 'on'), cmd('m2', 'off')],
    });
    expect(s.command?.id).toBe('m');
    const none = readLieferandoState({ commands: [cmd('s', 'off', SIZE_30)] });
    expect(none.command).toBeNull();
    expect(none.commands).toHaveLength(1);
  });

  it('lastResult: без target → MakiLove; детали size/item сохраняются', () => {
    const old = readLieferandoState({
      lastResult: { id: 'r', action: 'off', ok: true, count: 46, failed: 0, message: '', finishedAt: 'f' },
    });
    expect(old.lastResult?.target).toEqual(MAKI);
    const s = readLieferandoState({
      lastResult: {
        id: 'r',
        action: 'off',
        target: SIZE_30,
        ok: true,
        count: 23,
        failed: 0,
        message: '',
        finishedAt: 'f',
        already: 2,
        categories: ['Runde Pizza'],
        notFound: [],
      },
    });
    expect(s.lastResult).toMatchObject({ target: SIZE_30, already: 2, categories: ['Runde Pizza'] });
  });

  it('очередь обрезается до MAX_QUEUE', () => {
    const commands = Array.from({ length: MAX_QUEUE + 5 }, (_, i) => cmd(`c${i}`, 'off'));
    expect(readLieferandoState({ commands }).commands).toHaveLength(MAX_QUEUE);
  });
});

describe('readLieferandoTarget / lieferandoTargetKey / describeLieferandoTarget', () => {
  it('валидные цели проходят, мусор → null', () => {
    expect(readLieferandoTarget(MAKI)).toEqual(MAKI);
    expect(readLieferandoTarget({ kind: 'size', label: '  30 cm ' })).toEqual(SIZE_30);
    expect(readLieferandoTarget({ kind: 'item', names: [' Hawaiian ', '', 7] })).toEqual(ITEM_HAW);
    expect(readLieferandoTarget({ kind: 'size', label: '' })).toBeNull();
    expect(readLieferandoTarget({ kind: 'item', names: [] })).toBeNull();
    expect(readLieferandoTarget({ kind: 'pizza' })).toBeNull();
    expect(readLieferandoTarget(null)).toBeNull();
  });

  it('ключ цели: регистр/пробелы/× не различаются, порядок имён не важен', () => {
    expect(lieferandoTargetKey({ kind: 'size', label: '30  CM' })).toBe(lieferandoTargetKey(SIZE_30));
    expect(lieferandoTargetKey({ kind: 'size', label: 'ca. 27×37' })).toBe(
      lieferandoTargetKey({ kind: 'size', label: 'ca. 27x37' })
    );
    expect(lieferandoTargetKey({ kind: 'item', names: ['B', 'A', 'a'] })).toBe(
      lieferandoTargetKey({ kind: 'item', names: ['a', 'b'] })
    );
    expect(lieferandoTargetKey(SIZE_30)).not.toBe(lieferandoTargetKey({ kind: 'size', label: '36 cm' }));
    expect(lieferandoTargetKey(MAKI)).toBe('makilove');
  });

  it('описание цели для сообщений', () => {
    expect(describeLieferandoTarget(MAKI)).toBe('MakiLove');
    expect(describeLieferandoTarget(SIZE_30)).toBe('размер «30 cm»');
    expect(describeLieferandoTarget(ITEM_HAW)).toBe('позиция «Hawaiian»');
    expect(describeLieferandoTarget({ kind: 'item', names: ['A', 'B'] })).toBe('позиции: «A», «B»');
    // «включить всё в категории» = одна команда со всеми именами — не перечисляем
    expect(describeLieferandoTarget({ kind: 'item', names: ['A', 'B', 'C', 'D', 'E'] })).toBe('позиции (5 шт.)');
  });

  it('отчёт по целой категории: компактно, не найденные перечислены', () => {
    const names = Array.from({ length: 23 }, (_, i) => `Pizza ${i + 1}`);
    const t = formatLieferandoReport({
      id: 'r',
      ok: true,
      failed: 0,
      message: '',
      finishedAt: 'f',
      action: 'on',
      target: { kind: 'item', names },
      count: 40,
      already: 4,
      categories: ['Pizza', 'Runde Pizza'],
      notFound: ['Pizza 23'],
    });
    expect(t).toContain('позиции (23 шт.) <b>включены</b> (Pizza, Runde Pizza) — строк: 40. Ещё 4 уже были включены.');
    expect(t).toContain('⚠️ Не найдено на Lieferando: «Pizza 23».');
    expect(t.length).toBeLessThan(400);
  });
});

describe('requestLieferandoCommand', () => {
  it('ставит команды в очередь по порядку, чужие цели не затирает', async () => {
    mGet.mockResolvedValue({ commands: [cmd('m', 'off')], itemsState: 'on' });
    await requestLieferandoCommand('off', SIZE_30, NOW);
    const value = written();
    expect(mSet).toHaveBeenCalledWith(LIEFERANDO_MAKILOVE_KEY, expect.anything());
    expect(value.commands.map((c: any) => [c.id, c.target.kind])).toEqual([
      ['m', 'makilove'],
      [expect.any(String), 'size'],
    ]);
    expect(value.commands[1]).toMatchObject({ action: 'off', target: SIZE_30, requestedAt: NOW.toISOString() });
    expect(value.itemsState).toBe('on'); // остальное не тронуто
  });

  it('та же цель → заменяется (двойной тап = одна команда; off→on = последнее слово)', async () => {
    mGet.mockResolvedValue({ commands: [cmd('s', 'off', SIZE_30), cmd('m', 'off')] });
    await requestLieferandoCommand('off', { kind: 'size', label: '30  CM' }, NOW);
    let value = written();
    expect(value.commands).toHaveLength(2);
    expect(value.commands.map((c: any) => c.target.kind)).toEqual(['makilove', 'size']);
    expect(value.commands[1].id).not.toBe('s');

    mGet.mockResolvedValue({ commands: [cmd('s', 'off', SIZE_30)] });
    await requestLieferandoCommand('on', SIZE_30, NOW);
    value = written();
    expect(value.commands).toHaveLength(1);
    expect(value.commands[0].action).toBe('on');
  });

  it('в БД пишется только очередь (без вычисляемого command), наружу — с ним', async () => {
    mGet.mockResolvedValue({ command: cmd('old', 'off') });
    const state = await requestLieferandoToggle('on', NOW);
    const value = written();
    expect('command' in value).toBe(false);
    expect(value.commands).toHaveLength(1); // old (та же цель MakiLove) заменён
    expect(value.commands[0]).toMatchObject({ action: 'on', target: MAKI });
    expect(state.command?.action).toBe('on');
    expect(state.commands).toEqual(value.commands);
  });

  it('позиции: один и тот же набор имён в другом порядке — одна команда', async () => {
    mGet.mockResolvedValue({ commands: [cmd('i', 'off', { kind: 'item', names: ['A', 'B'] })] });
    await requestLieferandoCommand('off', { kind: 'item', names: ['B', 'A'] }, NOW);
    expect(written().commands).toHaveLength(1);
  });

  it('origin: «бессрочно»/«утреннее перевыключение» пишутся, кнопка бота — нет', async () => {
    mGet.mockResolvedValue({ commands: [] });
    await requestLieferandoCommand('off', SIZE_30, NOW, { origin: 'reapply' });
    expect(written().commands[0]).toMatchObject({ origin: 'reapply' });
    await requestLieferandoCommand('off', ITEM_HAW, NOW, { origin: 'indefinite' });
    expect(written().commands[0]).toMatchObject({ origin: 'indefinite' });
    await requestLieferandoCommand('off', SIZE_30, NOW, { origin: 'bot' });
    expect('origin' in written().commands[0]).toBe(false);
    await requestLieferandoCommand('off', SIZE_30, NOW);
    expect('origin' in written().commands[0]).toBe(false);
    // чтение: мусорный origin отбрасывается, валидный сохраняется
    const state = readLieferandoState({
      commands: [
        { ...cmd('a', 'off', SIZE_30), origin: 'reapply' },
        { ...cmd('b', 'off', SIZE_30), origin: 'alien' },
      ],
    });
    expect(state.commands.map((c) => c.origin)).toEqual(['reapply', undefined]);
  });
});

describe('claimLieferandoCommand', () => {
  const NEW_AGENT = { supportsTargets: true };

  it('нет команды → null, но heartbeat и версия обновлены', async () => {
    mGet.mockResolvedValue(null);
    const { command } = await claimLieferandoCommand('pc-1', NOW, 'v123', NEW_AGENT);
    expect(command).toBeNull();
    expect(written().agentSeenAt).toBe(NOW.toISOString());
    expect(written().agentVersion).toBe('v123');
  });

  it('FIFO: отдаётся голова очереди, хвост остаётся, команда переходит в running', async () => {
    mGet.mockResolvedValue({ commands: [cmd('s', 'off', SIZE_30), cmd('m', 'off')] });
    const { command } = await claimLieferandoCommand('pc-1', NOW, null, NEW_AGENT);
    expect(command).toMatchObject({ id: 's', target: SIZE_30 });
    const value = written();
    expect(value.commands.map((c: any) => c.id)).toEqual(['m']);
    expect(value.running).toMatchObject({ id: 's', action: 'off', target: SIZE_30, agentId: 'pc-1' });
    expect(value.running.startedAt).toBe(NOW.toISOString());
  });

  it('старый агент (без caps) пропускает size/item и берёт MakiLove за ними', async () => {
    mGet.mockResolvedValue({ commands: [cmd('s', 'off', SIZE_30), cmd('m', 'off'), cmd('i', 'on', ITEM_HAW)] });
    const { command } = await claimLieferandoCommand('pc-1', NOW);
    expect(command?.id).toBe('m');
    expect(written().commands.map((c: any) => c.id)).toEqual(['s', 'i']);
  });

  it('старый агент при очереди только из size/item → ничего', async () => {
    mGet.mockResolvedValue({ commands: [cmd('s', 'off', SIZE_30)] });
    const { command } = await claimLieferandoCommand('pc-1', NOW);
    expect(command).toBeNull();
    expect(written().commands).toHaveLength(1);
    expect(written().running).toBeNull();
  });

  it('свежий running НЕ отдаётся заново', async () => {
    mGet.mockResolvedValue({
      running: {
        ...cmd('c1', 'off'),
        startedAt: new Date(NOW.getTime() - 60_000).toISOString(),
        agentId: 'pc-1',
      },
    });
    const { command } = await claimLieferandoCommand('pc-1', NOW, null, NEW_AGENT);
    expect(command).toBeNull();
  });

  it('протухший running отдаётся заново при пустой очереди (с целью, агент перезапустился)', async () => {
    mGet.mockResolvedValue({
      running: {
        ...cmd('c1', 'on', SIZE_30),
        startedAt: new Date(NOW.getTime() - RUNNING_TTL_MS - 1000).toISOString(),
        agentId: 'pc-1',
      },
    });
    const { command } = await claimLieferandoCommand('pc-2', NOW, null, NEW_AGENT);
    expect(command).toMatchObject({ id: 'c1', target: SIZE_30 });
    expect(written().running.agentId).toBe('pc-2');
  });

  it('протухший size-running старому агенту не отдаётся', async () => {
    mGet.mockResolvedValue({
      running: {
        ...cmd('c1', 'on', SIZE_30),
        startedAt: new Date(NOW.getTime() - RUNNING_TTL_MS - 1000).toISOString(),
        agentId: 'pc-1',
      },
    });
    const { command } = await claimLieferandoCommand('pc-2', NOW);
    expect(command).toBeNull();
    expect(written().running.agentId).toBe('pc-1');
  });
});

describe('reportLieferandoResult', () => {
  it('origin команды доезжает до running и до lastResult (агент его не шлёт)', async () => {
    mGet.mockResolvedValue({ commands: [{ ...cmd('c1', 'off', SIZE_30), origin: 'reapply' }] });
    const { command } = await claimLieferandoCommand('pc-1', NOW, null, { supportsTargets: true });
    expect(command).toMatchObject({ id: 'c1', origin: 'reapply' });
    expect(written().running).toMatchObject({ id: 'c1', origin: 'reapply' });

    mGet.mockResolvedValue({ running: { ...written().running } });
    await reportLieferandoResult(
      { id: 'c1', action: 'off', target: SIZE_30, ok: true, count: 23, failed: 0, message: '' },
      NOW
    );
    expect(written().lastResult).toMatchObject({ id: 'c1', origin: 'reapply' });
    expect(readLieferandoState({ lastResult: written().lastResult }).lastResult?.origin).toBe('reapply');
  });

  it('протухший running с origin отдаётся заново вместе с origin', async () => {
    mGet.mockResolvedValue({
      commands: [],
      running: {
        ...cmd('c1', 'off', SIZE_30),
        origin: 'indefinite',
        startedAt: new Date(NOW.getTime() - RUNNING_TTL_MS - 1).toISOString(),
        agentId: 'pc-1',
      },
    });
    const { command } = await claimLieferandoCommand('pc-2', NOW, null, { supportsTargets: true });
    expect(command).toMatchObject({ id: 'c1', origin: 'indefinite' });
  });

  it('успех MakiLove off → running снят, itemsState=off, lastResult записан', async () => {
    mGet.mockResolvedValue({
      running: { ...cmd('c1', 'off'), startedAt: 'y', agentId: 'pc-1' },
      itemsState: 'on',
    });
    await reportLieferandoResult(
      { id: 'c1', action: 'off', target: MAKI, ok: true, count: 46, failed: 0, message: '' },
      NOW
    );
    const value = written();
    expect(value.running).toBeNull();
    expect(value.itemsState).toBe('off');
    expect(value.lastResult).toMatchObject({ id: 'c1', ok: true, count: 46, target: MAKI });
    expect(value.lastResult.finishedAt).toBe(NOW.toISOString());
  });

  it('успех по размеру НЕ трогает itemsState (это про MakiLove), детали сохраняются', async () => {
    mGet.mockResolvedValue({
      running: { ...cmd('c1', 'off', SIZE_30), startedAt: 'y', agentId: 'pc-1' },
      itemsState: 'on',
    });
    await reportLieferandoResult(
      {
        id: 'c1',
        action: 'off',
        target: SIZE_30,
        ok: true,
        count: 23,
        already: 0,
        failed: 0,
        message: '',
        categories: ['Runde Pizza'],
        notFound: [],
      },
      NOW
    );
    const value = written();
    expect(value.itemsState).toBe('on');
    expect(value.running).toBeNull();
    expect(value.lastResult).toMatchObject({ target: SIZE_30, categories: ['Runde Pizza'], already: 0 });
  });

  it('отчёт без target (старый агент) берёт цель из running по id', async () => {
    mGet.mockResolvedValue({
      running: { ...cmd('c1', 'on', ITEM_HAW), startedAt: 'y', agentId: 'pc-1' },
      itemsState: 'off',
    });
    await reportLieferandoResult({ id: 'c1', action: 'on', ok: true, count: 2, failed: 0, message: '' }, NOW);
    expect(written().lastResult.target).toEqual(ITEM_HAW);
    expect(written().itemsState).toBe('off');
  });

  it('провал → itemsState НЕ меняется', async () => {
    mGet.mockResolvedValue({ itemsState: 'on' });
    await reportLieferandoResult(
      { id: 'c9', action: 'off', target: MAKI, ok: false, count: 0, failed: 0, message: 'сессия истекла' },
      NOW
    );
    expect(written().itemsState).toBe('on');
  });

  it('отчёт о чужом id не снимает текущий running', async () => {
    mGet.mockResolvedValue({
      running: { ...cmd('c2', 'on'), startedAt: 'y', agentId: 'pc-1' },
    });
    await reportLieferandoResult(
      { id: 'c1', action: 'off', target: MAKI, ok: true, count: 3, failed: 0, message: '' },
      NOW
    );
    expect(written().running?.id).toBe('c2');
  });
});

describe('formatLieferandoReport', () => {
  const base = { id: 'r', ok: true, failed: 0, message: '', finishedAt: 'f' };
  const res = (extra: Partial<LieferandoResult> & Pick<LieferandoResult, 'action' | 'target' | 'count'>) =>
    ({ ...base, ...extra }) as LieferandoResult;

  it('бессрочно/перевыключение: вместо «утром Lieferando включит» — «бот выключит снова»; у reapply префикс', () => {
    const plain = formatLieferandoReport(res({ action: 'off', target: SIZE_30, count: 23 }));
    expect(plain).toContain('ℹ️ Утром Lieferando включит их сам.');
    const inf = formatLieferandoReport(res({ action: 'off', target: SIZE_30, count: 23, origin: 'indefinite' }));
    expect(inf).not.toContain('Утром Lieferando включит их сам');
    expect(inf).toContain('бот тут же выключит снова');
    expect(inf.startsWith('🛵 Lieferando')).toBe(true);
    const re = formatLieferandoReport(res({ action: 'off', target: SIZE_30, count: 23, origin: 'reapply' }));
    expect(re.startsWith('🌅 Утреннее перевыключение бессрочного стоп-листа:\n🛵 Lieferando')).toBe(true);
    expect(re).toContain('бот тут же выключит снова');
  });

  it('lieferandoReportWanted: кнопка бота — всегда; reapply — только при проблемах', () => {
    expect(lieferandoReportWanted(res({ action: 'off', target: SIZE_30, count: 23 }))).toBe(true);
    expect(lieferandoReportWanted(res({ action: 'off', target: SIZE_30, count: 0 }))).toBe(true);
    const ok = res({ action: 'off', target: SIZE_30, count: 23, origin: 'reapply' });
    expect(lieferandoReportWanted(ok)).toBe(false);
    expect(lieferandoReportWanted({ ...ok, count: 0, already: 23 })).toBe(false); // уже были выкл — тоже тишина
    expect(lieferandoReportWanted({ ...ok, ok: false })).toBe(true);
    expect(lieferandoReportWanted({ ...ok, failed: 1 })).toBe(true);
    expect(lieferandoReportWanted({ ...ok, notFound: ['X'] })).toBe(true);
    expect(lieferandoReportWanted({ ...ok, count: 0, already: 0 })).toBe(true); // ничего не нашли
  });

  it('MakiLove — прежние формулировки', () => {
    expect(formatLieferandoReport(res({ action: 'off', target: MAKI, count: 46 }))).toBe(
      '🛵 Lieferando: MakiLove <b>ВЫКЛЮЧЕН</b> — скрыто позиций: 46.\nℹ️ Утром Lieferando включит их сам.'
    );
    expect(formatLieferandoReport(res({ action: 'on', target: MAKI, count: 0 }))).toBe(
      '🛵 Lieferando: MakiLove <b>включён</b> — скрытых скриптом позиций не было.'
    );
    expect(formatLieferandoReport(res({ action: 'off', target: MAKI, count: 0, ok: false, message: 'сессия истекла' }))).toBe(
      '🛵❌ Lieferando: команда «выключить» НЕ выполнена.\nсессия истекла'
    );
  });

  it('размер: выключен у N позиций, где; не найден; уже были', () => {
    const t = formatLieferandoReport(
      res({ action: 'off', target: SIZE_30, count: 23, categories: ['Runde Pizza'] })
    );
    expect(t).toContain('размер «30 cm» <b>ВЫКЛЮЧЕН</b> у 23 позиций (Runde Pizza)');
    expect(t).toContain('Утром Lieferando включит их сам');

    expect(formatLieferandoReport(res({ action: 'off', target: SIZE_30, count: 0, already: 0 }))).toContain(
      'не найден ни в одной категории'
    );

    const all = formatLieferandoReport(
      res({ action: 'on', target: SIZE_30, count: 0, already: 23, categories: ['Runde Pizza'] })
    );
    expect(all).toContain('все 23 позиций уже были включены');
    expect(all).not.toContain('Утром');
  });

  it('позиция: выключена (категории), не найдено, ошибки', () => {
    const t = formatLieferandoReport(
      res({ action: 'off', target: ITEM_HAW, count: 2, categories: ['Pizza', 'Runde Pizza'] })
    );
    expect(t).toContain('позиция «Hawaiian» <b>выключена</b> (Pizza, Runde Pizza) — строк: 2.');

    const nf = formatLieferandoReport(
      res({
        action: 'on',
        target: { kind: 'item', names: ['Hawaiian', 'Nope'] },
        count: 1,
        already: 1,
        categories: ['Pizza'],
        notFound: ['Nope'],
      })
    );
    expect(nf).toContain('позиции: «Hawaiian», «Nope» <b>включены</b> (Pizza)');
    expect(nf).toContain('Ещё 1 уже были включены');
    expect(nf).toContain('⚠️ Не найдено на Lieferando: «Nope».');

    expect(
      formatLieferandoReport(res({ action: 'off', target: ITEM_HAW, count: 0, already: 0 }))
    ).toContain('на Lieferando не найдено');

    const fail = formatLieferandoReport(
      res({ action: 'off', target: ITEM_HAW, count: 1, failed: 1, message: 'не переключилось: 1' })
    );
    expect(fail).toContain('⚠️ Не удалось: 1. не переключилось: 1');

    expect(
      formatLieferandoReport(res({ action: 'on', target: SIZE_30, count: 0, ok: false, message: 'сессия истекла' }))
    ).toBe('🛵❌ Lieferando: команда «включить» (размер «30 cm») НЕ выполнена.\nсессия истекла');
  });
});
