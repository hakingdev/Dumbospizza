/**
 * Стоп размеров и позиций из Telegram-стоп-бота — серверная часть (БД).
 * Правило и типы — в ./state; здесь только чтение/запись флагов и ключа
 * `menuStopBot`. Экраны бота ходят сюда через MenuStopPort (см. buildMenuStopPort),
 * крон — через expireMenuStops.
 */
import { Product } from '../models/product.model';
import { Category } from '../models/category.model';
import { SizeVariation } from '../models/size-variation.model';
import { getSetting, setSetting } from '../settings';
import { syncSizeVariationToProducts } from '../size-variation-sync';
import {
  MENU_STOP_KEY,
  endOfBusinessDay,
  expiredMenuStops,
  readMenuStopState,
  type MenuCategoryRow,
  type MenuItemRow,
  type MenuSizeRow,
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

/** До какого времени действует стоп, поставленный сейчас. */
async function stopUntil(now: Date): Promise<string> {
  const settings = (await getSetting<Record<string, any>>(STORE_SETTINGS_KEY, {})) || {};
  return endOfBusinessDay(settings, now).toISOString();
}

const idOf = (doc: any): string => String(doc?._id ?? doc?.id ?? '');

function sizeRow(variation: any, state: MenuStopState): MenuSizeRow {
  const id = idOf(variation);
  const active = variation?.active !== false;
  return {
    id,
    name: String(variation?.name ?? ''),
    label: String(variation?.label ?? ''),
    active,
    stoppedUntil: !active && state.sizes[id] ? state.sizes[id].until : null,
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
    stoppedUntil: !available && state.products[id] ? state.products[id].until : null,
  };
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
    state.sizes[variationId] = { until: await stopUntil(now), name: String(variation.name ?? '') };
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
    state.products[productId] = { until: await stopUntil(now), name: String(product.name ?? '') };
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

  await writeState({ sizes: state.sizes, products: state.products });
  return { sizes, products };
}

/** Живой порт для экранов бота (lib/telegram-control.ts → processControlUpdate). */
export function buildMenuStopPort(): MenuStopPort {
  return {
    listSizes: () => listMenuSizes(),
    setSizeActive: (id, active) => setSizeActive(id, active),
    listCategories: () => listMenuCategories(),
    listCategoryItems: (id) => listCategoryItems(id),
    setItemAvailable: (id, available) => setProductAvailable(id, available),
    enableCategoryItems: (id) => enableCategoryItems(id),
  };
}
