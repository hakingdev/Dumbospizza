// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Мокаем слой настроек: applyBlockAction ходит в getSetting/setSetting.
vi.mock('../settings', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));
// Живой порт стоп-листа ходит в модели БД — здесь он не нужен: ядро получает
// порт через deps.menu.
vi.mock('../menu-stop/service', () => ({
  buildMenuStopPort: vi.fn(() => ({})),
}));
// Живая обвязка (processControlUpdate) должна прокинуть очередь Lieferando;
// саму очередь (settings) здесь не гоняем — только факт вызова.
vi.mock('../lieferando-makilove', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lieferando-makilove')>()),
  requestLieferandoCommand: vi.fn(async () => ({})),
}));

import { getSetting, setSetting } from '../settings';
import {
  parseControlAction,
  parseCommand,
  buildRootText,
  buildScopeText,
  buildPanel,
  applyBlockAction,
  handleControlUpdate,
  processControlUpdate,
  readBlockState,
  ctrlBlock,
  ctrlMenu,
  ctrlStatus,
  ctrlUnblock,
  CTRL_BLOCK_30,
  CTRL_BLOCK_60,
  CTRL_UNBLOCK,
  CTRL_STATUS,
  CTRL_ROOT,
  LIEF_MENU,
  LIEF_OFF,
  LIEF_ON,
  SIZES_MENU,
  ITEMS_MENU,
  ITEMS_PAGE_SIZE,
  ctrlSizeSet,
  ctrlItemsCategory,
  ctrlItemSet,
  ctrlItemsEnableAll,
  buildItemsKeyboard,
  type BlockState,
} from '../telegram-control';
import type { MenuCategoryRow, MenuItemRow, MenuSizeRow } from '../menu-stop/state';
import { buildMenuStopPort } from '../menu-stop/service';
import { requestLieferandoCommand } from '../lieferando-makilove';

/**
 * Служебный stop-бот: блокировка приёма заказов на 30/60 мин — целиком или по
 * цехам (🍕 пицца+Beilagen / 🍣 MakiLove).
 * Пишет в единые storeSettings.ordersBlockedUntil и workshopsBlockedUntil
 * (те же ключи читают админка, /api/orders и чекаут).
 * Тестируем: парсеры, рендер экранов, read-modify-write, ядро с гейтом по чату.
 */

const mGet = getSetting as unknown as ReturnType<typeof vi.fn>;
const mSet = setSetting as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

const state = (over: Partial<BlockState> = {}): BlockState => ({
  orders: '',
  workshops: { pizza: '', sushi: '' },
  ...over,
});

// --- unit: парсеры -----------------------------------------------------------

describe('parseControlAction', () => {
  it('кнопки цеха → действия с областью', () => {
    expect(parseControlAction(ctrlBlock('sushi', 30))).toEqual({
      type: 'block',
      scope: 'sushi',
      minutes: 30,
    });
    expect(parseControlAction(ctrlBlock('pizza', 60))).toEqual({
      type: 'block',
      scope: 'pizza',
      minutes: 60,
    });
    expect(parseControlAction(ctrlUnblock('sushi'))).toEqual({ type: 'unblock', scope: 'sushi' });
    expect(parseControlAction(ctrlStatus('pizza'))).toEqual({ type: 'status', scope: 'pizza' });
  });

  it('навигация: меню цеха и возврат в корень', () => {
    expect(parseControlAction(ctrlMenu('sushi'))).toEqual({ type: 'menu', scope: 'sushi' });
    expect(parseControlAction(ctrlMenu('all'))).toEqual({ type: 'menu', scope: 'all' });
    expect(parseControlAction(CTRL_ROOT)).toEqual({ type: 'root' });
  });

  it('старые кнопки без цеха → весь приём', () => {
    expect(parseControlAction(CTRL_BLOCK_30)).toEqual({ type: 'block', scope: 'all', minutes: 30 });
    expect(parseControlAction(CTRL_BLOCK_60)).toEqual({ type: 'block', scope: 'all', minutes: 60 });
    expect(parseControlAction(CTRL_UNBLOCK)).toEqual({ type: 'unblock', scope: 'all' });
    expect(parseControlAction(CTRL_STATUS)).toEqual({ type: 'status', scope: 'all' });
  });

  it('стоп-лист: размеры и позиции', () => {
    const id = '6ab13e01bac562cf69912ba6';
    expect(parseControlAction(SIZES_MENU)).toEqual({ type: 'sizes_menu' });
    expect(parseControlAction(ITEMS_MENU)).toEqual({ type: 'items_menu' });
    expect(parseControlAction(ctrlSizeSet(id, false))).toEqual({
      type: 'size_set',
      variationId: id,
      active: false,
    });
    expect(parseControlAction(ctrlSizeSet(id, true))).toEqual({
      type: 'size_set',
      variationId: id,
      active: true,
    });
    expect(parseControlAction(ctrlItemsCategory(id, 2))).toEqual({
      type: 'items_category',
      categoryId: id,
      page: 2,
    });
    expect(parseControlAction(ctrlItemSet(id, true, 1))).toEqual({
      type: 'item_set',
      productId: id,
      available: true,
      page: 1,
    });
    expect(parseControlAction(ctrlItemsEnableAll(id, 0))).toEqual({
      type: 'items_enable_all',
      categoryId: id,
      page: 0,
    });
    // callback_data у Telegram ≤ 64 байт
    expect(Buffer.byteLength(ctrlItemSet(id, false, 99))).toBeLessThanOrEqual(64);
    expect(parseControlAction('ctrl_sz_maybe_' + id)).toBeNull();
    expect(parseControlAction('ctrl_it_cat_' + id)).toBeNull(); // без страницы
  });

  it('чужие/пустые/несуществующий цех → null', () => {
    expect(parseControlAction('status_ready_1')).toBeNull();
    expect(parseControlAction('ctrl_grill_block_30')).toBeNull();
    expect(parseControlAction('ctrl_menu_grill')).toBeNull();
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

// --- unit: рендер экранов ----------------------------------------------------

describe('buildRootText', () => {
  const now = new Date('2026-07-05T17:00:00.000Z');

  it('всё открыто → оба цеха работают', () => {
    const text = buildRootText(state(), now);
    expect(text).toContain('MakiLove');
    expect(text).not.toContain('стоп до');
  });

  it('стоит только суши → стоп у суши, пицца работает', () => {
    const until = new Date('2026-07-05T17:30:00.000Z').toISOString();
    const text = buildRootText(state({ workshops: { pizza: '', sushi: until } }), now);
    const sushiLine = text.split('\n').find((l) => l.includes('MakiLove'))!;
    const pizzaLine = text.split('\n').find((l) => l.includes('Пицца'))!;
    expect(sushiLine).toContain('стоп до');
    expect(pizzaLine).toContain('работает');
  });

  it('глобальный стоп → предупреждение, что цеха ничего не получат', () => {
    const until = new Date('2026-07-05T17:30:00.000Z').toISOString();
    expect(buildRootText(state({ orders: until }), now)).toContain('Весь приём остановлен');
  });
});

describe('buildScopeText', () => {
  const now = new Date('2026-07-05T17:00:00.000Z');
  const until = new Date('2026-07-05T17:30:00.000Z').toISOString();

  it('цех остановлен → ЦЕХ ОСТАНОВЛЕН', () => {
    const text = buildScopeText('sushi', state({ workshops: { pizza: '', sushi: until } }), now);
    expect(text).toContain('ЦЕХ ОСТАНОВЛЕН');
  });

  it('истёкшая блокировка цеха → ЦЕХ РАБОТАЕТ', () => {
    const past = new Date('2026-07-05T16:00:00.000Z').toISOString();
    expect(buildScopeText('pizza', state({ workshops: { pizza: past, sushi: '' } }), now)).toContain(
      'ЦЕХ РАБОТАЕТ'
    );
  });

  it('весь приём: заблокирован / активен', () => {
    expect(buildScopeText('all', state({ orders: until }), now)).toContain('ЗАБЛОКИРОВАН');
    expect(buildScopeText('all', state(), now)).toContain('АКТИВЕН');
  });
});

describe('buildPanel', () => {
  it('корень: кнопки обоих цехов и всего приёма', () => {
    const data = buildPanel({ type: 'root' }, state()).keyboard.inline_keyboard.flat().map((b) => b.callback_data);
    expect(data).toContain(ctrlMenu('pizza'));
    expect(data).toContain(ctrlMenu('sushi'));
    expect(data).toContain(ctrlMenu('all'));
    expect(data).toContain(LIEF_MENU);
    expect(data).toContain(SIZES_MENU);
    expect(data).toContain(ITEMS_MENU);
  });

  it('экран размеров: кнопка каждого размера переключает в ПРОТИВОПОЛОЖНОЕ состояние', () => {
    const sizes: MenuSizeRow[] = [
      { id: 'a', name: '30 cm', label: '', active: true, stoppedUntil: null },
      {
        id: 'b',
        name: '36 cm',
        label: '',
        active: false,
        stoppedUntil: '2026-11-02T20:30:00.000Z',
      },
      { id: 'c', name: '40 cm', label: '', active: false, stoppedUntil: null },
    ];
    const panel = buildPanel({ type: 'sizes', sizes }, state(), new Date('2026-11-02T18:00:00Z'));
    const data = panel.keyboard.inline_keyboard.flat().map((b) => b.callback_data);
    expect(data).toContain(ctrlSizeSet('a', false));
    expect(data).toContain(ctrlSizeSet('b', true));
    expect(data).toContain(SIZES_MENU);
    expect(data).toContain(CTRL_ROOT);
    expect(panel.text).toContain('🟢 30 cm');
    expect(panel.text).toContain('36 cm — выключен ботом до 21:30');
    expect(panel.text).toContain('40 cm — выключен (админка/POS)');
  });

  it('экран категории: пагинация, «включить всё», имя с & экранировано', () => {
    const category: MenuCategoryRow = { id: 'cat', name: 'Pizza & Co', itemCount: 23, stoppedCount: 1 };
    const items: MenuItemRow[] = Array.from({ length: 23 }, (_, i) => ({
      id: `p${i}`,
      name: i === 0 ? 'Mac & Cheese' : `Pizza ${i}`,
      categoryId: 'cat',
      available: i !== 3,
      stoppedUntil: null,
    }));
    const panel = buildPanel({ type: 'items', categoryId: 'cat', category, items, page: 1 }, state());
    expect(panel.text).toContain('Pizza &amp; Co');
    expect(panel.text).toContain('стр. 2/3');
    const flat = panel.keyboard.inline_keyboard.flat();
    const data = flat.map((b) => b.callback_data);
    // на странице 1 лежат p10..p19
    expect(data).toContain(ctrlItemSet('p10', false, 1));
    expect(data).not.toContain(ctrlItemSet('p3', true, 1));
    expect(data).toContain(ctrlItemsCategory('cat', 0));
    expect(data).toContain(ctrlItemsCategory('cat', 2));
    expect(data).toContain(ctrlItemsEnableAll('cat', 1));
    expect(data).toContain(ITEMS_MENU);
    // первая страница: p3 выключен → кнопка включает
    const first = buildPanel({ type: 'items', categoryId: 'cat', category, items, page: 0 }, state());
    expect(first.text).toContain('Mac &amp; Cheese');
    expect(first.keyboard.inline_keyboard.flat().map((b) => b.callback_data)).toContain(
      ctrlItemSet('p3', true, 0)
    );
    expect(first.keyboard.inline_keyboard.flat().map((b) => b.text)).toContain('🔴 Pizza 3');
    // стрелки: на первой нет «⬅️», на последней нет «➡️»
    expect(buildItemsKeyboard('cat', items, 0).inline_keyboard.flat().map((b) => b.text)).not.toContain('⬅️');
    expect(buildItemsKeyboard('cat', items, 2).inline_keyboard.flat().map((b) => b.text)).not.toContain('➡️');
    expect(buildItemsKeyboard('cat', items, 0).inline_keyboard[ITEMS_PAGE_SIZE].map((b) => b.text)).toEqual([
      '1/3',
      '➡️',
    ]);
  });

  it('удалённая категория: только навигация назад', () => {
    const panel = buildPanel(
      { type: 'items', categoryId: 'gone', category: null, items: [], page: 0 },
      state()
    );
    expect(panel.text).toContain('не найдена');
    expect(panel.keyboard.inline_keyboard.flat().map((b) => b.callback_data)).toEqual([
      ITEMS_MENU,
      CTRL_ROOT,
    ]);
  });

  it('экран цеха: кнопки со своей областью + назад', () => {
    const data = buildPanel({ type: 'scope', scope: 'sushi' }, state())
      .keyboard.inline_keyboard.flat()
      .map((b) => b.callback_data);
    expect(data).toEqual([
      ctrlBlock('sushi', 30),
      ctrlBlock('sushi', 60),
      ctrlUnblock('sushi'),
      ctrlStatus('sushi'),
      CTRL_ROOT,
    ]);
  });
});

// --- unit: read-modify-write -------------------------------------------------

describe('applyBlockAction', () => {
  const now = new Date('2026-07-05T17:00:00.000Z');
  const until30 = new Date('2026-07-05T17:30:00.000Z').toISOString();

  it('блок цеха: пишет только свой цех, ОСТАЛЬНЫЕ настройки сохраняет', async () => {
    mGet.mockResolvedValue({ storeName: 'Dumbo', ordersBlockedReason: 'x', ordersBlockedUntil: '' });
    const next = await applyBlockAction({ type: 'block', scope: 'sushi', minutes: 30 }, now);
    expect(next).toEqual({ orders: '', workshops: { pizza: '', sushi: until30 } });
    expect(mSet).toHaveBeenCalledWith('storeSettings', {
      storeName: 'Dumbo',
      ordersBlockedReason: 'x',
      ordersBlockedUntil: '',
      workshopsBlockedUntil: { pizza: '', sushi: until30 },
    });
  });

  it('блок цеха не трогает второй цех', async () => {
    mGet.mockResolvedValue({ workshopsBlockedUntil: { pizza: 'keep-me', sushi: '' } });
    const next = await applyBlockAction({ type: 'block', scope: 'sushi', minutes: 60 }, now);
    expect(next.workshops.pizza).toBe('keep-me');
  });

  it('разблокировка цеха: чистит только его', async () => {
    mGet.mockResolvedValue({ workshopsBlockedUntil: { pizza: 'p', sushi: 's' } });
    const next = await applyBlockAction({ type: 'unblock', scope: 'pizza' });
    expect(next.workshops).toEqual({ pizza: '', sushi: 's' });
  });

  it('блок всего приёма: цеха не трогает', async () => {
    mGet.mockResolvedValue({ workshopsBlockedUntil: { pizza: '', sushi: 's' } });
    const next = await applyBlockAction({ type: 'block', scope: 'all', minutes: 30 }, now);
    expect(next).toEqual({ orders: until30, workshops: { pizza: '', sushi: 's' } });
  });

  it('разблокировка всего приёма открывает и цеха', async () => {
    mGet.mockResolvedValue({ ordersBlockedUntil: 'sometime', workshopsBlockedUntil: { pizza: 'p', sushi: 's' } });
    const next = await applyBlockAction({ type: 'unblock', scope: 'all' });
    expect(next).toEqual({ orders: '', workshops: { pizza: '', sushi: '' } });
    expect(mSet).toHaveBeenCalledWith('storeSettings', {
      ordersBlockedUntil: '',
      workshopsBlockedUntil: { pizza: '', sushi: '' },
    });
  });

  it('status/menu: НЕ пишут, возвращают текущее состояние', async () => {
    mGet.mockResolvedValue({ ordersBlockedUntil: 'abc', workshopsBlockedUntil: { sushi: 'xyz' } });
    expect(await applyBlockAction({ type: 'status', scope: 'all' })).toEqual({
      orders: 'abc',
      workshops: { pizza: '', sushi: 'xyz' },
    });
    expect(await applyBlockAction({ type: 'menu', scope: 'sushi' })).toBeTruthy();
    expect(mSet).not.toHaveBeenCalled();
  });
});

describe('readBlockState', () => {
  it('мусор в БД → пустое состояние, без падений', () => {
    expect(readBlockState({ ordersBlockedUntil: 42, workshopsBlockedUntil: 'nope' })).toEqual({
      orders: '',
      workshops: { pizza: '', sushi: '' },
    });
    expect(readBlockState(null)).toEqual({ orders: '', workshops: { pizza: '', sushi: '' } });
  });
});

// --- integration: handleControlUpdate ---------------------------------------

const ALLOWED = '-100999';

const makeDeps = (over: Record<string, any> = {}) => ({
  answerCallbackQuery: vi.fn(async () => ({})),
  editPanel: vi.fn(async () => ({})),
  sendPanel: vi.fn(async () => ({})),
  getBlockState: vi.fn(async () => ({ ordersBlockedUntil: '' })),
  applyAction: vi.fn(async (a: any) =>
    a.type === 'block'
      ? a.scope === 'all'
        ? state({ orders: '2026-07-05T17:30:00.000Z' })
        : state({ workshops: { pizza: '', sushi: '', [a.scope]: '2026-07-05T17:30:00.000Z' } })
      : state()
  ),
  allowedChatId: ALLOWED,
  log: vi.fn(),
  ...over,
});

const cbUpdate = (data: string, chatId: number | string = -100999, over: Record<string, any> = {}) => ({
  callback_query: { id: 'cb1', data, message: { message_id: 42, chat: { id: chatId } }, ...over },
});

describe('handleControlUpdate', () => {
  it('блок суши из своей группы: applyAction со своим цехом, ack, экран цеха', async () => {
    const deps = makeDeps();
    const res = await handleControlUpdate(cbUpdate(ctrlBlock('sushi', 30)), deps);
    expect(deps.applyAction).toHaveBeenCalledWith({ type: 'block', scope: 'sushi', minutes: 30 });
    expect(deps.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(deps.editPanel).toHaveBeenCalledTimes(1);
    // Перерисован экран того же цеха, а не корень.
    const panel = (deps.editPanel as any).mock.calls[0][2];
    expect(panel.text).toContain('MakiLove');
    expect(panel.keyboard.inline_keyboard.flat().map((b: any) => b.callback_data)).toContain(
      ctrlUnblock('sushi')
    );
    expect(res).toEqual({ handled: true, reason: 'blocked' });
  });

  it('старая кнопка «Блок 30» → весь приём', async () => {
    const deps = makeDeps();
    const res = await handleControlUpdate(cbUpdate(CTRL_BLOCK_30), deps);
    expect(deps.applyAction).toHaveBeenCalledWith({ type: 'block', scope: 'all', minutes: 30 });
    expect(res).toEqual({ handled: true, reason: 'blocked' });
  });

  it('открыть меню цеха: НИЧЕГО не пишет, только перерисовка', async () => {
    const deps = makeDeps();
    const res = await handleControlUpdate(cbUpdate(ctrlMenu('pizza')), deps);
    expect(deps.applyAction).not.toHaveBeenCalled();
    expect(deps.getBlockState).toHaveBeenCalledTimes(1);
    expect(deps.editPanel).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ handled: true, reason: 'menu' });
  });

  it('⬅️ Назад: корневой экран без записи', async () => {
    const deps = makeDeps();
    const res = await handleControlUpdate(cbUpdate(CTRL_ROOT), deps);
    expect(deps.applyAction).not.toHaveBeenCalled();
    const panel = (deps.editPanel as any).mock.calls[0][2];
    expect(panel.keyboard.inline_keyboard.flat().map((b: any) => b.callback_data)).toContain(
      ctrlMenu('sushi')
    );
    expect(res).toEqual({ handled: true, reason: 'menu' });
  });

  it('чужой чат: отклоняем, applyAction НЕ вызывается', async () => {
    const deps = makeDeps();
    const res = await handleControlUpdate(cbUpdate(ctrlBlock('sushi', 30), 12345), deps);
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

  it('Lieferando: кнопка «Выключить» ставит команду и рисует экран Lieferando', async () => {
    const lief = {
      command: { id: 'c1', action: 'off', requestedAt: '2026-08-19T18:00:00.000Z' },
      running: null,
      lastResult: null,
      itemsState: 'unknown',
      agentSeenAt: null,
    };
    const deps = makeDeps({
      getLieferandoState: vi.fn(async () => lief),
      requestLieferandoToggle: vi.fn(async () => lief),
    });
    const res = await handleControlUpdate(cbUpdate(LIEF_OFF), deps);
    expect(deps.requestLieferandoToggle).toHaveBeenCalledWith('off');
    expect(deps.applyAction).not.toHaveBeenCalled(); // блокировки цехов не тронуты
    const panel = (deps.editPanel as any).mock.calls[0][2];
    expect(panel.text).toContain('Lieferando');
    expect(panel.text).toContain('ждёт агента');
    expect(panel.keyboard.inline_keyboard.flat().map((b: any) => b.callback_data)).toContain(
      LIEF_ON
    );
    expect(res).toEqual({ handled: true, reason: 'lieferando' });
  });

  it('Lieferando: меню только читает состояние, без записи', async () => {
    const deps = makeDeps({
      getLieferandoState: vi.fn(async () => ({
        command: null,
        running: null,
        lastResult: null,
        itemsState: 'on',
        agentSeenAt: null,
      })),
      requestLieferandoToggle: vi.fn(),
    });
    const res = await handleControlUpdate(cbUpdate(LIEF_MENU), deps);
    expect(deps.requestLieferandoToggle).not.toHaveBeenCalled();
    expect(deps.getLieferandoState).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ handled: true, reason: 'lieferando' });
  });

  it('Lieferando без зависимостей (не настроен) → error, ничего не пишем', async () => {
    const deps = makeDeps(); // getLieferandoState/requestLieferandoToggle отсутствуют
    const res = await handleControlUpdate(cbUpdate(LIEF_OFF), deps);
    expect(deps.applyAction).not.toHaveBeenCalled();
    expect(deps.editPanel).not.toHaveBeenCalled();
    expect(res).toEqual({ handled: false, reason: 'error' });
  });

  // --- стоп-лист: экраны «Размеры» / «Позиции» ---------------------------------

  const sizeRows = (active36: boolean): MenuSizeRow[] => [
    { id: 's30', name: '30 cm', label: '', active: true, stoppedUntil: null },
    {
      id: 's36',
      name: '36 cm',
      label: '',
      active: active36,
      stoppedUntil: active36 ? null : '2026-11-02T20:30:00.000Z',
    },
  ];
  const catRow: MenuCategoryRow = { id: 'cat1', name: 'Pizza', itemCount: 2, stoppedCount: 0 };
  const itemRows = (hawaiiOn: boolean): MenuItemRow[] => [
    { id: 'p1', name: 'Hawaiian', categoryId: 'cat1', available: hawaiiOn, stoppedUntil: null },
    { id: 'p2', name: 'Margherita', categoryId: 'cat1', available: true, stoppedUntil: null },
  ];
  const makeMenu = (over: Record<string, any> = {}) => ({
    listSizes: vi.fn(async () => sizeRows(true)),
    setSizeActive: vi.fn(async (id: string, active: boolean) =>
      id === 's36' ? sizeRows(active).find((s) => s.id === 's36')! : null
    ),
    listCategories: vi.fn(async () => [catRow]),
    listCategoryItems: vi.fn(async () => ({ category: catRow, items: itemRows(true) })),
    setItemAvailable: vi.fn(async (id: string, available: boolean) =>
      id === 'p1' ? itemRows(available)[0] : null
    ),
    enableCategoryItems: vi.fn(async () => [itemRows(true)[0]]),
    ...over,
  });

  it('размер выключить: флаг сайта + команда Lieferando {size, label}, экран размеров', async () => {
    const menu = makeMenu();
    const queueLieferando = vi.fn(async () => ({}));
    const deps = makeDeps({ menu, queueLieferando });
    const res = await handleControlUpdate(cbUpdate(ctrlSizeSet('s36', false)), deps);
    expect(menu.setSizeActive).toHaveBeenCalledWith('s36', false);
    expect(queueLieferando).toHaveBeenCalledWith('off', { kind: 'size', label: '36 cm' });
    expect(deps.applyAction).not.toHaveBeenCalled(); // блокировки цехов не тронуты
    const toast = (deps.answerCallbackQuery as any).mock.calls[0][1] as string;
    expect(toast).toContain('36 cm');
    expect(toast).toContain('выключен');
    expect(toast).toContain('Lieferando');
    const panel = (deps.editPanel as any).mock.calls[0][2];
    expect(panel.text).toContain('Размеры');
    expect(panel.keyboard.inline_keyboard.flat().map((b: any) => b.callback_data)).toContain(
      ctrlSizeSet('s30', false)
    );
    expect(res).toEqual({ handled: true, reason: 'menu_stop' });
  });

  it('без queueLieferando сайт переключается, тост предупреждает', async () => {
    const menu = makeMenu();
    const deps = makeDeps({ menu });
    await handleControlUpdate(cbUpdate(ctrlSizeSet('s36', true)), deps);
    expect(menu.setSizeActive).toHaveBeenCalledWith('s36', true);
    const toast = (deps.answerCallbackQuery as any).mock.calls[0][1] as string;
    expect(toast).toContain('включён');
    expect(toast).toContain('Lieferando не настроен');
  });

  it('сбой очереди Lieferando не откатывает сайт и не роняет обработку', async () => {
    const menu = makeMenu();
    const deps = makeDeps({
      menu,
      queueLieferando: vi.fn(async () => {
        throw new Error('settings down');
      }),
    });
    const res = await handleControlUpdate(cbUpdate(ctrlSizeSet('s36', false)), deps);
    expect(res).toEqual({ handled: true, reason: 'menu_stop' });
    expect((deps.answerCallbackQuery as any).mock.calls[0][1]).toContain('команда не поставлена');
    expect(deps.editPanel).toHaveBeenCalledTimes(1);
  });

  it('позиция выключить: флаг + Lieferando {item, names}, перерисован экран её категории', async () => {
    const menu = makeMenu();
    const queueLieferando = vi.fn(async () => ({}));
    const deps = makeDeps({ menu, queueLieferando });
    const res = await handleControlUpdate(cbUpdate(ctrlItemSet('p1', false, 0)), deps);
    expect(menu.setItemAvailable).toHaveBeenCalledWith('p1', false);
    expect(queueLieferando).toHaveBeenCalledWith('off', { kind: 'item', names: ['Hawaiian'] });
    expect(menu.listCategoryItems).toHaveBeenCalledWith('cat1');
    const panel = (deps.editPanel as any).mock.calls[0][2];
    expect(panel.text).toContain('Pizza');
    expect(res).toEqual({ handled: true, reason: 'menu_stop' });
  });

  it('«включить всё в категории»: одна команда Lieferando со всеми именами', async () => {
    const menu = makeMenu();
    const queueLieferando = vi.fn(async () => ({}));
    const deps = makeDeps({ menu, queueLieferando });
    await handleControlUpdate(cbUpdate(ctrlItemsEnableAll('cat1', 1)), deps);
    expect(menu.enableCategoryItems).toHaveBeenCalledWith('cat1');
    expect(queueLieferando).toHaveBeenCalledWith('on', { kind: 'item', names: ['Hawaiian'] });
    expect((deps.answerCallbackQuery as any).mock.calls[0][1]).toContain('Включено позиций: 1');
  });

  it('«включить всё», когда всё уже включено: без команды Lieferando', async () => {
    const menu = makeMenu({ enableCategoryItems: vi.fn(async () => []) });
    const queueLieferando = vi.fn(async () => ({}));
    const deps = makeDeps({ menu, queueLieferando });
    await handleControlUpdate(cbUpdate(ctrlItemsEnableAll('cat1', 0)), deps);
    expect(queueLieferando).not.toHaveBeenCalled();
    expect((deps.answerCallbackQuery as any).mock.calls[0][1]).toContain('уже включены');
  });

  it('навигация по категориям/страницам ничего не пишет', async () => {
    const menu = makeMenu();
    const queueLieferando = vi.fn(async () => ({}));
    const deps = makeDeps({ menu, queueLieferando });
    await handleControlUpdate(cbUpdate(ITEMS_MENU), deps);
    await handleControlUpdate(cbUpdate(ctrlItemsCategory('cat1', 0)), deps);
    await handleControlUpdate(cbUpdate(SIZES_MENU), deps);
    expect(menu.setSizeActive).not.toHaveBeenCalled();
    expect(menu.setItemAvailable).not.toHaveBeenCalled();
    expect(menu.enableCategoryItems).not.toHaveBeenCalled();
    expect(queueLieferando).not.toHaveBeenCalled();
    expect(deps.editPanel).toHaveBeenCalledTimes(3);
    const categoriesPanel = (deps.editPanel as any).mock.calls[0][2];
    expect(categoriesPanel.keyboard.inline_keyboard.flat().map((b: any) => b.callback_data)).toContain(
      ctrlItemsCategory('cat1', 0)
    );
  });

  it('неизвестный размер: тост-предупреждение, Lieferando не трогаем', async () => {
    const menu = makeMenu();
    const queueLieferando = vi.fn(async () => ({}));
    const deps = makeDeps({ menu, queueLieferando });
    const res = await handleControlUpdate(cbUpdate(ctrlSizeSet('nope', false)), deps);
    expect(queueLieferando).not.toHaveBeenCalled();
    expect((deps.answerCallbackQuery as any).mock.calls[0][1]).toContain('не найден');
    expect(res).toEqual({ handled: true, reason: 'menu_stop' });
  });

  it('порт стоп-листа не передан → error, ничего не пишем', async () => {
    const deps = makeDeps();
    const res = await handleControlUpdate(cbUpdate(ctrlSizeSet('s36', false)), deps);
    expect(deps.editPanel).not.toHaveBeenCalled();
    expect(res).toEqual({ handled: false, reason: 'error' });
  });

  it('сбой порта (БД) → error, ack-предупреждение, экран не трогаем', async () => {
    const menu = makeMenu({
      setItemAvailable: vi.fn(async () => {
        throw new Error('DB down');
      }),
    });
    const deps = makeDeps({ menu });
    const res = await handleControlUpdate(cbUpdate(ctrlItemSet('p1', false, 0)), deps);
    expect(deps.editPanel).not.toHaveBeenCalled();
    expect(res).toEqual({ handled: false, reason: 'error' });
  });

  it('разблокировка цеха → unblocked', async () => {
    const deps = makeDeps();
    const res = await handleControlUpdate(cbUpdate(ctrlUnblock('pizza')), deps);
    expect(deps.applyAction).toHaveBeenCalledWith({ type: 'unblock', scope: 'pizza' });
    expect(res).toEqual({ handled: true, reason: 'unblocked' });
  });

  it('обновить статус цеха → status, панель перерисована', async () => {
    const deps = makeDeps({ applyAction: vi.fn(async () => state()) });
    const res = await handleControlUpdate(cbUpdate(ctrlStatus('sushi')), deps);
    expect(res).toEqual({ handled: true, reason: 'status' });
    expect(deps.editPanel).toHaveBeenCalledTimes(1);
  });

  it('applyAction падает: error, ack-предупреждение, editPanel НЕ вызывается', async () => {
    const deps = makeDeps({
      applyAction: vi.fn(async () => {
        throw new Error('DB down');
      }),
    });
    const res = await handleControlUpdate(cbUpdate(ctrlBlock('pizza', 60)), deps);
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
    const res = await handleControlUpdate(cbUpdate(ctrlBlock('sushi', 30)), deps);
    expect(res).toEqual({ handled: true, reason: 'blocked' });
    expect(deps.editPanel).toHaveBeenCalledTimes(1);
  });

  it('/panel из своей группы: корневой экран', async () => {
    const deps = makeDeps();
    const res = await handleControlUpdate(
      { message: { text: '/panel@dumbosstoporder_bot', chat: { id: -100999 } } },
      deps
    );
    expect(deps.sendPanel).toHaveBeenCalledTimes(1);
    const panel = (deps.sendPanel as any).mock.calls[0][1];
    expect(panel.text).toContain('Управление приёмом заказов');
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

// --- живая обвязка вебхука -----------------------------------------------------

describe('processControlUpdate', () => {
  it('прокидывает очередь Lieferando: кнопка размера → requestLieferandoCommand', async () => {
    const row: MenuSizeRow = { id: 's36', name: '36 cm', label: '', active: false, stoppedUntil: null };
    (buildMenuStopPort as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      listSizes: vi.fn(async () => [row]),
      setSizeActive: vi.fn(async () => row),
      listCategories: vi.fn(async () => []),
      listCategoryItems: vi.fn(async () => ({ category: null, items: [] })),
      setItemAvailable: vi.fn(async () => null),
      enableCategoryItems: vi.fn(async () => []),
    });
    // Bot API — заглушка fetch: проверяем только, что dep прокинут и экран отрисован
    const fetchMock = vi.fn(async () => ({ json: async () => ({ ok: true, result: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await processControlUpdate(cbUpdate(ctrlSizeSet('s36', false)), {
        botToken: 'token',
        chatId: ALLOWED,
        webhookSecret: '',
      });
      expect(res.handled).toBe(true);
      expect(requestLieferandoCommand).toHaveBeenCalledWith('off', { kind: 'size', label: '36 cm' });
      const urls = fetchMock.mock.calls.map((c: any[]) => String(c[0]));
      expect(urls.some((u) => u.endsWith('/answerCallbackQuery'))).toBe(true);
      expect(urls.some((u) => u.endsWith('/editMessageText'))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
