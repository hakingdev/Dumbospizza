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
