// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Серверная часть стоп-листа бота (lib/menu-stop/service) на замоканных моделях:
 * режим «бессрочно» пишет запись без срока, «до конца дня» — конец смены;
 * сверка бессрочных записей с живыми флагами; ночной сброс режима; утренний
 * триггер «раз в день».
 */

const models = vi.hoisted(() => {
  const chain = (rows: any[]) => ({
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    lean: vi.fn(async () => rows),
  });
  return {
    chain,
    product: { find: vi.fn(() => chain([])), findByIdAndUpdate: vi.fn(), updateMany: vi.fn() },
    variation: { find: vi.fn(() => chain([])), findByIdAndUpdate: vi.fn() },
    category: { find: vi.fn(() => chain([])), findById: vi.fn() },
  };
});
vi.mock('../models/product.model', () => ({ Product: models.product, default: models.product }));
vi.mock('../models/size-variation.model', () => ({
  SizeVariation: models.variation,
  default: models.variation,
}));
vi.mock('../models/category.model', () => ({ Category: models.category, default: models.category }));
vi.mock('../size-variation-sync', () => ({ syncSizeVariationToProducts: vi.fn(async () => {}) }));
vi.mock('../settings', () => ({ getSetting: vi.fn(), setSetting: vi.fn() }));

import { getSetting, setSetting } from '../settings';
import {
  claimDailyReapply,
  getMenuStopMode,
  markDailyReapply,
  reconcileIndefiniteMenuStops,
  resetMenuStopMode,
  setMenuStopMode,
  setProductAvailable,
  setSizeActive,
} from '../menu-stop/service';
import { MENU_STOP_KEY } from '../menu-stop/state';

const mGet = getSetting as unknown as ReturnType<typeof vi.fn>;
const mSet = setSetting as unknown as ReturnType<typeof vi.fn>;

/** getSetting по ключу: стоп-лист бота + настройки магазина (график, зона). */
const settings = (menuStop: any, store: any = {}) =>
  mGet.mockImplementation(async (key: string, fallback: any) =>
    key === MENU_STOP_KEY ? menuStop : key === 'storeSettings' ? store : fallback
  );
const written = () => mSet.mock.calls.filter((c) => c[0] === MENU_STOP_KEY).at(-1)![1];

const STORE = {
  ordersTimeZone: 'Europe/Berlin',
  ordersWeeklySchedule: {
    mon: [{ start: '17:00', end: '21:30' }],
    tue: [{ start: '17:00', end: '21:30' }],
    wed: [], thu: [], fri: [], sat: [], sun: [],
  },
};
const NOW = new Date('2026-11-02T18:00:00.000Z'); // пн 19:00 Берлин

beforeEach(() => {
  vi.clearAllMocks();
  models.product.find.mockImplementation(() => models.chain([]));
  models.variation.find.mockImplementation(() => models.chain([]));
});

describe('setSizeActive / setProductAvailable — срок записи по режиму', () => {
  it('режим «до конца дня» (по умолчанию) → until = конец смены', async () => {
    settings({ sizes: {}, products: {} }, STORE);
    models.variation.findByIdAndUpdate.mockResolvedValue({ _id: 's36', name: '36 cm', active: false });
    const row = await setSizeActive('s36', false, NOW);
    expect(models.variation.findByIdAndUpdate).toHaveBeenCalledWith('s36', { active: false }, { new: true });
    expect(written().sizes.s36).toEqual({ until: '2026-11-02T20:30:00.000Z', name: '36 cm' });
    expect(written().mode).toBe('day');
    expect(row).toMatchObject({ id: 's36', active: false, botStop: { until: '2026-11-02T20:30:00.000Z' } });
  });

  it('режим «бессрочно» → until = null, график не нужен', async () => {
    settings({ mode: 'indefinite', sizes: {}, products: {} }, STORE);
    models.product.findByIdAndUpdate.mockResolvedValue({
      _id: 'p1',
      name: 'Vegan philly',
      category: 'cat1',
      available: false,
    });
    const row = await setProductAvailable('p1', false, NOW);
    expect(written().products.p1).toEqual({ until: null, name: 'Vegan philly' });
    expect(written().mode).toBe('indefinite'); // режим не затёрт
    expect(row).toMatchObject({ id: 'p1', available: false, botStop: { until: null } });
  });

  it('включение снимает запись бота в любом режиме', async () => {
    settings({ mode: 'indefinite', sizes: { s36: { until: null, name: '36 cm' } }, products: {} }, STORE);
    models.variation.findByIdAndUpdate.mockResolvedValue({ _id: 's36', name: '36 cm', active: true });
    const row = await setSizeActive('s36', true, NOW);
    expect(written().sizes).toEqual({});
    expect(row).toMatchObject({ active: true, botStop: null });
  });
});

describe('режим кнопок', () => {
  it('get/set: пишется только при смене; ночной сброс возвращает «до конца дня»', async () => {
    settings({ mode: 'day', sizes: {}, products: {} });
    expect(await getMenuStopMode()).toBe('day');
    expect(await setMenuStopMode('day')).toBe('day');
    expect(mSet).not.toHaveBeenCalled();
    expect(await setMenuStopMode('indefinite')).toBe('indefinite');
    expect(written().mode).toBe('indefinite');

    expect(await resetMenuStopMode()).toBe(false); // был day — нечего сбрасывать
    settings({ mode: 'indefinite', sizes: { s: { until: null, name: 'x' } }, products: {} });
    expect(await resetMenuStopMode()).toBe(true);
    expect(written()).toMatchObject({ mode: 'day', sizes: { s: { until: null, name: 'x' } } }); // записи целы
  });
});

describe('reconcileIndefiniteMenuStops', () => {
  it('держит выключенное ботом, снимает включённое руками и удалённое', async () => {
    settings(
      {
        sizes: {
          s36: { until: null, name: '36 cm' },
          s40: { until: null, name: '40 cm' }, // включили в админке
          sday: { until: '2026-11-02T20:30:00.000Z', name: '30 cm' }, // не бессрочный — не трогаем
        },
        products: {
          p1: { until: null, name: 'Vegan philly' },
          gone: { until: null, name: 'Удалённая' }, // товара больше нет
        },
      },
      STORE
    );
    models.variation.find.mockImplementation(() =>
      models.chain([
        { _id: 's36', name: '36 cm', active: false },
        { _id: 's40', name: '40 cm', active: true },
      ])
    );
    models.product.find.mockImplementation(() =>
      models.chain([{ _id: 'p1', name: 'Vegan philly steak pizza', available: false }])
    );
    const r = await reconcileIndefiniteMenuStops();
    expect(models.variation.find).toHaveBeenCalledWith({ _id: { $in: ['s36', 's40'] } });
    expect(models.product.find).toHaveBeenCalledWith({ _id: { $in: ['p1', 'gone'] } });
    // имя — живое (в БД переименовали), не из записи
    expect(r).toEqual({
      sizes: [{ id: 's36', name: '36 cm' }],
      products: [{ id: 'p1', name: 'Vegan philly steak pizza' }],
    });
    expect(Object.keys(written().sizes).sort()).toEqual(['s36', 'sday']);
    expect(Object.keys(written().products)).toEqual(['p1']);
  });

  it('нет бессрочных → ни запросов к БД, ни записи', async () => {
    settings({ sizes: { s: { until: '2026-11-02T20:30:00.000Z', name: 'x' } }, products: {} });
    expect(await reconcileIndefiniteMenuStops()).toEqual({ sizes: [], products: [] });
    expect(models.variation.find).not.toHaveBeenCalled();
    expect(mSet).not.toHaveBeenCalled();
  });

  it('всё на месте → запись не перезаписывается', async () => {
    settings({ sizes: { s36: { until: null, name: '36 cm' } }, products: {} });
    models.variation.find.mockImplementation(() => models.chain([{ _id: 's36', name: '36 cm', active: false }]));
    await reconcileIndefiniteMenuStops();
    expect(mSet).not.toHaveBeenCalled();
  });
});

describe('claimDailyReapply / markDailyReapply (утренний триггер из поллинга агента)', () => {
  const morning = new Date('2026-11-03T08:00:00.000Z'); // 09:00 Берлин
  it('первый поллинг после 08:30 — забирает день, второй — нет', async () => {
    settings({ sizes: {}, products: {}, reapplyDay: '2026-11-02' }, STORE);
    expect(await claimDailyReapply(morning)).toBe(true);
    expect(written().reapplyDay).toBe('2026-11-03');
    settings({ sizes: {}, products: {}, reapplyDay: '2026-11-03' }, STORE);
    expect(await claimDailyReapply(morning)).toBe(false);
    expect(mSet).toHaveBeenCalledTimes(1);
  });
  it('до 08:30 — рано', async () => {
    settings({ sizes: {}, products: {} }, STORE);
    expect(await claimDailyReapply(new Date('2026-11-03T07:00:00.000Z'))).toBe(false);
    expect(mSet).not.toHaveBeenCalled();
  });
  it('ручной запуск отмечает день, чтобы поллинг не повторил сводку', async () => {
    settings({ sizes: {}, products: {} }, STORE);
    await markDailyReapply(morning);
    expect(written().reapplyDay).toBe('2026-11-03');
    settings({ sizes: {}, products: {}, reapplyDay: '2026-11-03' }, STORE);
    await markDailyReapply(morning);
    expect(mSet).toHaveBeenCalledTimes(1);
  });
});

// --- позиции только на Lieferando (снимок каталога Hub в ключе lieferandoCatalog) ----

import { enableCategoryItems, listCategoryItems, listMenuCategories } from '../menu-stop/service';
import { LIEFERANDO_CATALOG_KEY, hubCategoryId, hubItemId } from '../lieferando/catalog';

describe('Hub-строки без пары на сайте', () => {
  const catalog = () => ({
    takenAt: '2026-11-04T08:00:00.000Z',
    receivedAt: '2026-11-04T08:01:00.000Z',
    failedCategories: [],
    hubOnlyKeys: [],
    mismatchKeys: [],
    categories: [
      {
        name: 'Angebot',
        items: [
          { name: 'Gyoza Gemüse Vegetarische (7 Stück)', on: true, variations: [] },
          { name: 'Neu: Sushi Balls Lachs Panko 7stk', on: false, variations: [] },
        ],
      },
      {
        name: 'Burger',
        items: [
          { name: 'Dry Aged Burger', on: true, variations: [] },
          { name: 'Shrimp Party Burger', on: false, variations: [] },
        ],
      },
    ],
  });
  const BURGER_ID = hubCategoryId('Burger');
  const SUSHI_ID = hubItemId('Neu: Sushi Balls Lachs Panko 7stk');
  const SHRIMP_ID = hubItemId('Shrimp Party Burger');

  /** settings по ключам: стоп-лист бота, настройки магазина, снимок каталога (изменяемый). */
  const withCatalog = (menuStop: any, cat: any = catalog()) => {
    let stored = cat;
    mGet.mockImplementation(async (key: string, fallback: any) =>
      key === MENU_STOP_KEY ? menuStop : key === 'storeSettings' ? STORE : key === LIEFERANDO_CATALOG_KEY ? stored : fallback
    );
    mSet.mockImplementation(async (key: string, value: any) => {
      if (key === LIEFERANDO_CATALOG_KEY) stored = value;
    });
    return () => stored;
  };
  const siteProducts = [{ _id: 'p1', name: 'Gyoza Gemüse (7 Stück)', category: 'angebot1', available: true }];

  beforeEach(() => {
    models.category.find.mockImplementation(() =>
      models.chain([{ _id: 'angebot1', name: 'Angebot', active: true }])
    );
    models.product.find.mockImplementation(() => models.chain(siteProducts));
  });

  it('listMenuCategories: Angebot считает свой Hub-довесок, Burger — виртуальная категория', async () => {
    withCatalog({ sizes: {}, products: {} });
    const rows = await listMenuCategories(NOW);
    expect(rows).toEqual([
      { id: 'angebot1', name: 'Angebot', itemCount: 2, stoppedCount: 1 },
      { id: BURGER_ID, name: 'Burger', itemCount: 2, stoppedCount: 1, hubOnly: true },
    ]);
  });

  it('без снимка каталога экран как раньше', async () => {
    settings({ sizes: {}, products: {} }, STORE);
    const rows = await listMenuCategories(NOW);
    expect(rows).toEqual([{ id: 'angebot1', name: 'Angebot', itemCount: 1, stoppedCount: 0 }]);
  });

  it('listCategoryItems: Hub-строки ниже товаров сайта (Angebot) и целиком в виртуальной (Burger)', async () => {
    withCatalog({ sizes: {}, products: { [SHRIMP_ID]: { until: null, name: 'Shrimp Party Burger' } } });
    models.category.findById.mockReturnValue({ lean: async () => ({ _id: 'angebot1', name: 'Angebot' }) });
    const angebot = await listCategoryItems('angebot1', NOW);
    expect(angebot.items.map((i) => [i.id, i.name, i.available, i.hubOnly ?? false])).toEqual([
      ['p1', 'Gyoza Gemüse (7 Stück)', true, false],
      [SUSHI_ID, 'Neu: Sushi Balls Lachs Panko 7stk', false, true],
    ]);
    expect(angebot.hubSnapshotAt).toBe('2026-11-04T08:00:00.000Z');
    expect(angebot.category).toMatchObject({ itemCount: 2, stoppedCount: 1 });

    const burger = await listCategoryItems(BURGER_ID, NOW);
    expect(burger.category).toEqual({ id: BURGER_ID, name: 'Burger', itemCount: 2, stoppedCount: 1, hubOnly: true });
    expect(burger.items.map((i) => [i.name, i.available, i.botStop])).toEqual([
      ['Dry Aged Burger', true, null],
      ['Shrimp Party Burger', false, { until: null }], // бессрочная запись бота
    ]);
    expect((await listCategoryItems('hub-c00000000', NOW)).category).toBeNull();
  });

  it('setProductAvailable(hub-i…): снимок обновлён оптимистично, запись бота только в «бессрочно»', async () => {
    const stored = withCatalog({ mode: 'indefinite', sizes: {}, products: {} });
    const row = await setProductAvailable(SHRIMP_ID, false, NOW);
    expect(models.product.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(row).toMatchObject({ id: SHRIMP_ID, name: 'Shrimp Party Burger', available: false, hubOnly: true, categoryId: BURGER_ID, botStop: { until: null } });
    expect(written().products[SHRIMP_ID]).toEqual({ until: null, name: 'Shrimp Party Burger' });

    const on = await setProductAvailable(SHRIMP_ID, true, NOW);
    expect(on).toMatchObject({ available: true, botStop: null });
    expect(written().products).toEqual({});
    expect(stored().categories[1].items[1].on).toBe(true);

    // Hub-довесок категории сайта возвращает id ЭТОЙ категории — экран перерисуется там
    const sushi = await setProductAvailable(SUSHI_ID, true, NOW);
    expect(sushi?.categoryId).toBe('angebot1');
    expect(await setProductAvailable('hub-i00000000', false, NOW)).toBeNull();
  });

  it('setProductAvailable(hub-i…) в режиме «до конца дня»: записи бота нет — Hub включит сам', async () => {
    withCatalog({ mode: 'day', sizes: {}, products: {} });
    const row = await setProductAvailable(SHRIMP_ID, false, NOW);
    expect(row).toMatchObject({ available: false, botStop: null });
    expect(written().products).toEqual({});
  });

  it('enableCategoryItems: виртуальная категория включает Hub-строки без записи в товары', async () => {
    const stored = withCatalog({ sizes: {}, products: { [SHRIMP_ID]: { until: null, name: 'Shrimp Party Burger' } } });
    const enabled = await enableCategoryItems(BURGER_ID);
    expect(models.product.updateMany).not.toHaveBeenCalled();
    expect(enabled.map((i) => [i.name, i.available, i.hubOnly])).toEqual([['Shrimp Party Burger', true, true]]);
    expect(written().products).toEqual({});
    expect(stored().categories[1].items[1].on).toBe(true);
  });

  it('reconcileIndefiniteMenuStops: бессрочная Hub-запись держится, пока строка есть в снимке', async () => {
    withCatalog({
      mode: 'indefinite',
      sizes: {},
      products: {
        [SHRIMP_ID]: { until: null, name: 'Shrimp Party Burger' },
        'hub-i00000000': { until: null, name: 'Удалённый бургер' },
      },
    });
    const r = await reconcileIndefiniteMenuStops();
    expect(r.products).toEqual([{ id: SHRIMP_ID, name: 'Shrimp Party Burger' }]);
    expect(Object.keys(written().products)).toEqual([SHRIMP_ID]);
  });
});
