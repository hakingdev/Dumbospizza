/**
 * Стоп размеров и позиций из Telegram-стоп-бота — серверная часть (БД).
 * Правило и типы — в ./state; здесь только чтение/запись флагов и ключа
 * `menuStopBot`. Экраны бота ходят сюда через MenuStopPort (см. buildMenuStopPort),
 * ночной крон — через expireMenuStops/resetMenuStopMode, утренний —
 * через reconcileIndefiniteMenuStops.
 */
import { Product } from '../models/product.model';
import { Category } from '../models/category.model';
import { SizeVariation } from '../models/size-variation.model';
import { getSetting, setSetting } from '../settings';
import { syncSizeVariationToProducts } from '../size-variation-sync';
import {
  MENU_STOP_KEY,
  dayKeyInTimeZone,
  endOfBusinessDay,
  expiredMenuStops,
  indefiniteMenuStops,
  readMenuStopState,
  reapplyDue,
  type MenuBotStop,
  type MenuCategoryRow,
  type MenuItemRow,
  type MenuSizeRow,
  type MenuStopMode,
  type MenuStopNamed,
  type MenuStopPort,
  type MenuStopState,
} from './state';

const STORE_SETTINGS_KEY = 'storeSettings';

async function readState(): Promise<MenuStopState> {
  return readMenuStopState(await getSetting(MENU_STOP_KEY, null));
}

async function writeState(state: MenuStopState): Promise<void> {
  await setSetting(MENU_STOP_KEY, state);
}

/**
 * До какого времени действует стоп, поставленный сейчас: конец рабочего дня,
 * а в режиме «бессрочно» — null (снимается только кнопкой «включить»).
 */
async function stopUntil(state: MenuStopState, now: Date): Promise<string | null> {
  if (state.mode === 'indefinite') return null;
  const settings = (await getSetting<Record<string, any>>(STORE_SETTINGS_KEY, {})) || {};
  return endOfBusinessDay(settings, now).toISOString();
}

const idOf = (doc: any): string => String(doc?._id ?? doc?.id ?? '');

/** Подсказка «кем выключено» — только для выключенных строк и только если ботом. */
const botStopOf = (off: boolean, entry: { until: string | null } | undefined): MenuBotStop =>
  off && entry ? { until: entry.until } : null;

function sizeRow(variation: any, state: MenuStopState): MenuSizeRow {
  const id = idOf(variation);
  const active = variation?.active !== false;
  return {
    id,
    name: String(variation?.name ?? ''),
    label: String(variation?.label ?? ''),
    active,
    botStop: botStopOf(!active, state.sizes[id]),
  };
}

function itemRow(product: any, state: MenuStopState): MenuItemRow {
  const id = idOf(product);
  const available = product?.available !== false;
  return {
    id,
    name: String(product?.name ?? ''),
    categoryId: String(product?.category ?? ''),
    available,
    botStop: botStopOf(!available, state.products[id]),
  };
}

// --- режим кнопок ----------------------------------------------------------------

export async function getMenuStopMode(): Promise<MenuStopMode> {
  return (await readState()).mode;
}

export async function setMenuStopMode(mode: MenuStopMode): Promise<MenuStopMode> {
  const state = await readState();
  if (state.mode !== mode) await writeState({ ...state, mode });
  return mode;
}

/**
 * Ночной крон: режим возвращается на «до конца дня», чтобы завтрашний тап по
 * закончившейся позиции не выключил её навсегда. Возвращает, был ли сброс.
 */
export async function resetMenuStopMode(): Promise<boolean> {
  const state = await readState();
  if (state.mode === 'day') return false;
  await writeState({ ...state, mode: 'day' });
  return true;
}

// --- размеры (библиотека) --------------------------------------------------------

export async function listMenuSizes(now: Date = new Date()): Promise<MenuSizeRow[]> {
  // Экран — самое частое место, где просроченный стоп заметят раньше крона.
  await expireMenuStops(now);
  const [variations, state] = await Promise.all([
    SizeVariation.find().sort({ order: 1 }).lean(),
    readState(),
  ]);
  return (variations as any[]).map((v) => sizeRow(v, state));
}

/**
 * Та же логика, что PUT /api/size-variations/[id]: библиотека + копии в
 * товарах (syncSizeVariationToProducts сбрасывает и 60-секундный кэш).
 */
export async function setSizeActive(
  variationId: string,
  active: boolean,
  now: Date = new Date()
): Promise<MenuSizeRow | null> {
  const variation: any = await SizeVariation.findByIdAndUpdate(
    variationId,
    { active },
    { new: true }
  );
  if (!variation) return null;
  await syncSizeVariationToProducts(variation);

  const state = await readState();
  if (active) {
    delete state.sizes[variationId];
  } else {
    state.sizes[variationId] = {
      until: await stopUntil(state, now),
      name: String(variation.name ?? ''),
    };
  }
  await writeState(state);
  return sizeRow(variation, state);
}

// --- позиции (товары по категориям) --------------------------------------------

/** Только активные категории — скрытую в админке категорию из бота не включить. */
export async function listMenuCategories(now: Date = new Date()): Promise<MenuCategoryRow[]> {
  await expireMenuStops(now);
  const [categories, products] = await Promise.all([
    Category.find({ active: true }).sort({ order: 1 }).lean(),
    Product.find({}).select('category available').lean(),
  ]);
  const stats = new Map<string, { total: number; stopped: number }>();
  for (const product of products as any[]) {
    const key = String(product.category ?? '');
    const stat = stats.get(key) ?? { total: 0, stopped: 0 };
    stat.total += 1;
    if (product.available === false) stat.stopped += 1;
    stats.set(key, stat);
  }
  return (categories as any[]).map((category) => {
    const stat = stats.get(idOf(category)) ?? { total: 0, stopped: 0 };
    return {
      id: idOf(category),
      name: String(category.name ?? ''),
      itemCount: stat.total,
      stoppedCount: stat.stopped,
    };
  });
}

export async function listCategoryItems(
  categoryId: string,
  now: Date = new Date()
): Promise<{ category: MenuCategoryRow | null; items: MenuItemRow[] }> {
  await expireMenuStops(now);
  const [category, products, state] = await Promise.all([
    Category.findById(categoryId).lean(),
    Product.find({ category: categoryId }).select('name category available').sort({ name: 1 }).lean(),
    readState(),
  ]);
  const items = (products as any[]).map((p) => itemRow(p, state));
  return {
    category: category
      ? {
          id: categoryId,
          name: String((category as any).name ?? ''),
          itemCount: items.length,
          stoppedCount: items.filter((i) => !i.available).length,
        }
      : null,
    items,
  };
}

export async function setProductAvailable(
  productId: string,
  available: boolean,
  now: Date = new Date()
): Promise<MenuItemRow | null> {
  const product: any = await Product.findByIdAndUpdate(productId, { available }, { new: true });
  if (!product) return null;

  const state = await readState();
  if (available) {
    delete state.products[productId];
  } else {
    state.products[productId] = {
      until: await stopUntil(state, now),
      name: String(product.name ?? ''),
    };
  }
  await writeState(state);
  return itemRow(product, state);
}

/** Включает ВСЕ выключенные позиции категории (не только выключенные ботом). */
export async function enableCategoryItems(categoryId: string): Promise<MenuItemRow[]> {
  const stopped = (await Product.find({ category: categoryId, available: false })
    .select('name category available')
    .sort({ name: 1 })
    .lean()) as any[];
  if (!stopped.length) return [];

  const ids = stopped.map(idOf);
  await Product.updateMany({ _id: { $in: ids } }, { available: true });

  const state = await readState();
  for (const id of ids) delete state.products[id];
  await writeState(state);
  return stopped.map((p) => itemRow({ ...p, available: true }, state));
}

// --- авто-включение --------------------------------------------------------------

/**
 * Включает обратно всё, что бот выключил и чей срок прошёл. Запись снимается и
 * тогда, когда флаг уже включили в админке: иначе панель вечно показывала бы
 * «до 21:30». Возвращает имена включённого — для сообщения в группу.
 */
export async function expireMenuStops(
  now: Date = new Date()
): Promise<{ sizes: string[]; products: string[] }> {
  const state = await readState();
  const expired = expiredMenuStops(state, now);
  if (!expired.sizes.length && !expired.products.length) return { sizes: [], products: [] };

  const sizes: string[] = [];
  for (const id of expired.sizes) {
    const variation: any = await SizeVariation.findByIdAndUpdate(id, { active: true }, { new: true });
    if (variation) {
      await syncSizeVariationToProducts(variation);
      sizes.push(String(variation.name || state.sizes[id].name || id));
    }
    delete state.sizes[id];
  }

  const products: string[] = [];
  for (const id of expired.products) {
    const product: any = await Product.findByIdAndUpdate(id, { available: true }, { new: true });
    if (product) products.push(String(product.name || state.products[id].name || id));
    delete state.products[id];
  }

  await writeState({ ...state, sizes: state.sizes, products: state.products });
  return { sizes, products };
}

// --- бессрочный стоп-лист (утренний крон) ----------------------------------------

/**
 * Бессрочные записи бота, сверенные с живыми флагами: если размер/позицию уже
 * включили руками (админка/POS) или удалили, запись снимается — иначе утренний
 * крон выключал бы её на Lieferando каждый день, хотя на сайте она давно
 * продаётся. Возвращает то, что действительно выключено и держится ботом.
 */
export async function reconcileIndefiniteMenuStops(): Promise<{
  sizes: MenuStopNamed[];
  products: MenuStopNamed[];
}> {
  const state = await readState();
  const wanted = indefiniteMenuStops(state);
  if (!wanted.sizes.length && !wanted.products.length) return { sizes: [], products: [] };

  const variations = wanted.sizes.length
    ? ((await SizeVariation.find({ _id: { $in: wanted.sizes.map((s) => s.id) } })
        .select('name active')
        .lean()) as any[])
    : [];
  const products = wanted.products.length
    ? ((await Product.find({ _id: { $in: wanted.products.map((p) => p.id) } })
        .select('name available')
        .lean()) as any[])
    : [];
  const liveSize = new Map(variations.map((v) => [idOf(v), v]));
  const liveProduct = new Map(products.map((p) => [idOf(p), p]));

  let dirty = false;
  const sizes: MenuStopNamed[] = [];
  for (const entry of wanted.sizes) {
    const live = liveSize.get(entry.id);
    if (live && live.active === false) {
      sizes.push({ id: entry.id, name: String(live.name || entry.name || entry.id) });
    } else {
      delete state.sizes[entry.id];
      dirty = true;
    }
  }
  const items: MenuStopNamed[] = [];
  for (const entry of wanted.products) {
    const live = liveProduct.get(entry.id);
    if (live && live.available === false) {
      items.push({ id: entry.id, name: String(live.name || entry.name || entry.id) });
    } else {
      delete state.products[entry.id];
      dirty = true;
    }
  }
  if (dirty) await writeState(state);
  return { sizes, products: items };
}

/**
 * Утренний триггер из поллинга агента: если сегодня ещё не перевыключали и
 * уже пора (reapplyDue), отмечает день выполненным и возвращает true. Отметка
 * ставится ДО запуска — два параллельных поллинга не запустят перевыключение
 * дважды (дубль команд и так не страшен: очередь дедупит по цели, а вот две
 * сводки в группе — шум).
 */
export async function claimDailyReapply(now: Date = new Date()): Promise<boolean> {
  const [state, settings] = await Promise.all([
    readState(),
    getSetting<Record<string, any>>(STORE_SETTINGS_KEY, {}).then((v) => v || {}),
  ]);
  if (!reapplyDue(state, settings, now)) return false;
  await writeState({ ...state, reapplyDay: dayKeyInTimeZone(settings.ordersTimeZone || 'Europe/Berlin', now) });
  return true;
}

/** Ручной запуск (крон-роут) тоже отмечает день — чтобы триггер из поллинга не повторил сводку. */
export async function markDailyReapply(now: Date = new Date()): Promise<void> {
  const [state, settings] = await Promise.all([
    readState(),
    getSetting<Record<string, any>>(STORE_SETTINGS_KEY, {}).then((v) => v || {}),
  ]);
  const day = dayKeyInTimeZone(settings.ordersTimeZone || 'Europe/Berlin', now);
  if (state.reapplyDay !== day) await writeState({ ...state, reapplyDay: day });
}

/** Живой порт для экранов бота (lib/telegram-control.ts → processControlUpdate). */
export function buildMenuStopPort(): MenuStopPort {
  return {
    getMode: () => getMenuStopMode(),
    setMode: (mode) => setMenuStopMode(mode),
    listSizes: () => listMenuSizes(),
    setSizeActive: (id, active) => setSizeActive(id, active),
    listCategories: () => listMenuCategories(),
    listCategoryItems: (id) => listCategoryItems(id),
    setItemAvailable: (id, available) => setProductAvailable(id, available),
    enableCategoryItems: (id) => enableCategoryItems(id),
  };
}
