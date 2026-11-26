/**
 * Стоп размеров и позиций из Telegram-стоп-бота — серверная часть (БД).
 * Правило и типы — в ./state; здесь только чтение/запись флагов и ключа
 * `menuStopBot`. Экраны бота ходят сюда через MenuStopPort (см. buildMenuStopPort),
 * ночной крон — через expireMenuStops/resetMenuStopMode, утренний —
 * через reconcileIndefiniteMenuStops.
 *
 * Позиции, которые есть ТОЛЬКО на Lieferando (нет товара на сайте — Burger,
 * «Neu: Sushi Balls…»), экран «📋 Позиции» берёт из снимка каталога Hub
 * (lib/lieferando/catalog-store): в категории сайта с тем же именем — ниже
 * товаров сайта, иначе — в виртуальной категории hub-c…. Их кнопка переключает
 * только снимок (оптимистично) и ставит агенту команду; флага на сайте нет.
 *
 * Из того же снимка экран берёт ещё две вещи для товаров САЙТА:
 *   - состояние на Lieferando (MenuItemRow.hub) — расхождение с флагом сайта видно сразу;
 *   - «гостей» (MenuItemRow.guestFrom): товар живёт в другой категории сайта, но
 *     на Lieferando лежит в категории с именем как у этой — показываем и здесь
 *     (гёдза: сайт «MakiLove Sushi», Hub «Angebot»), иначе её ищут и не находят.
 */
import { Product } from '../models/product.model';
import { Category } from '../models/category.model';
import { SizeVariation } from '../models/size-variation.model';
import { getSetting, setSetting } from '../settings';
import { syncSizeVariationToProducts } from '../size-variation-sync';
import {
  findHubCategory,
  findHubItems,
  hubCategoryId,
  hubKeysByCategory,
  hubOnlyByCategory,
  hubStateByKey,
  isHubCategoryId,
  isHubItemId,
  normalizeCategoryName,
  type HubItemState,
  type HubOnlyRow,
  type LieferandoCatalogRecord,
} from '../lieferando/catalog';
import {
  getLieferandoCatalogRecord,
  loadSiteItemKeys,
  patchCatalogWithResult,
  setStoredHubItemOn,
} from '../lieferando/catalog-store';
import { itemKey } from '../lieferando/item-key';
import {
  MENU_STOP_KEY,
  dayKeyInTimeZone,
  endOfBusinessDay,
  expiredMenuStops,
  indefiniteMenuStops,
  readMenuStopState,
  reapplyDue,
  type MenuBotStop,
  type MenuCategoryItems,
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

function itemRow(product: any, state: MenuStopState, hub?: HubExtras | null): MenuItemRow {
  const id = idOf(product);
  const available = product?.available !== false;
  const name = String(product?.name ?? '');
  const row: MenuItemRow = {
    id,
    name,
    categoryId: String(product?.category ?? ''),
    available,
    botStop: botStopOf(!available, state.products[id]),
  };
  const hubState = hub?.stateByKey.get(itemKey(name));
  if (hubState) row.hub = hubState;
  return row;
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

// --- позиции только на Lieferando (снимок каталога Hub) ---------------------------

/** Hub-строки без пары на сайте по категориям Hub (ключ — нормализованное имя категории). */
interface HubExtras {
  catalog: LieferandoCatalogRecord;
  byCategory: Map<string, { name: string; rows: HubOnlyRow[] }>;
  /** общий переключатель на Lieferando по ключу имени */
  stateByKey: Map<string, HubItemState>;
  /** ключи имён строк Hub по нормализованному имени категории Hub */
  keysByCategory: Map<string, Set<string>>;
}

/** null — снимка каталога ещё нет (агент не снимал) — тогда экран как раньше. */
async function loadHubExtras(): Promise<HubExtras | null> {
  const catalog = await getLieferandoCatalogRecord();
  if (!catalog) return null;
  const siteKeys = await loadSiteItemKeys();
  const byCategory = new Map<string, { name: string; rows: HubOnlyRow[] }>();
  hubOnlyByCategory(catalog, siteKeys).forEach((rows, name) => {
    byCategory.set(normalizeCategoryName(name), { name, rows });
  });
  return {
    catalog,
    byCategory,
    stateByKey: hubStateByKey(catalog),
    keysByCategory: hubKeysByCategory(catalog),
  };
}

/**
 * «Гости» категории: товары сайта из ДРУГИХ активных категорий, чьи строки на
 * Lieferando лежат в категории Hub с именем как у этой. Позиции, у которых в
 * самой категории уже есть товар с тем же именем, гостями не дублируются.
 */
function guestProducts(
  categoryId: string,
  categoryName: string,
  allProducts: any[],
  activeCategoryNames: Map<string, string>,
  hub: HubExtras | null
): any[] {
  const keysHere = hub?.keysByCategory.get(normalizeCategoryName(categoryName));
  if (!keysHere || !keysHere.size) return [];
  const own = new Set<string>();
  for (const p of allProducts) {
    if (String(p?.category ?? '') === categoryId) own.add(itemKey(p?.name));
  }
  return allProducts
    .filter((p) => {
      const cat = String(p?.category ?? '');
      if (cat === categoryId || !activeCategoryNames.has(cat)) return false;
      const key = itemKey(p?.name);
      return Boolean(key) && keysHere.has(key) && !own.has(key);
    })
    .sort((a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? ''), 'de'));
}

function guestRow(
  product: any,
  screenCategoryId: string,
  activeCategoryNames: Map<string, string>,
  state: MenuStopState,
  hub: HubExtras | null
): MenuItemRow {
  return {
    ...itemRow(product, state, hub),
    categoryId: screenCategoryId,
    guestFrom: activeCategoryNames.get(String(product?.category ?? '')) ?? '',
  };
}

const namesById = (categories: any[]): Map<string, string> =>
  new Map(categories.map((c) => [idOf(c), String(c?.name ?? '')] as [string, string]));

function hubItemRow(row: HubOnlyRow, categoryId: string, state: MenuStopState): MenuItemRow {
  return {
    id: row.id,
    name: row.name,
    categoryId,
    available: row.on,
    botStop: botStopOf(!row.on, state.products[row.id]),
    hubOnly: true,
  };
}

/** id экрана для категории Hub: категория сайта с тем же именем либо виртуальная hub-c…. */
async function hubCategoryScreenId(hubCategoryName: string): Promise<string> {
  const norm = normalizeCategoryName(hubCategoryName);
  const categories = (await Category.find({ active: true }).select('name').lean()) as any[];
  const same = categories.find((c) => normalizeCategoryName(String(c.name ?? '')) === norm);
  return same ? idOf(same) : hubCategoryId(hubCategoryName);
}

// --- позиции (товары по категориям) --------------------------------------------

/**
 * Только активные категории — скрытую в админке категорию из бота не включить.
 * Плюс виртуальные категории Hub, где есть позиции только на Lieferando
 * (у категорий сайта с тем же именем такие позиции считаются в их счётчиках).
 */
export async function listMenuCategories(now: Date = new Date()): Promise<MenuCategoryRow[]> {
  await expireMenuStops(now);
  const [categories, products, hub] = await Promise.all([
    Category.find({ active: true }).sort({ order: 1 }).lean(),
    Product.find({}).select('name category available').lean(),
    loadHubExtras(),
  ]);
  const activeNames = namesById(categories as any[]);
  const stats = new Map<string, { total: number; stopped: number }>();
  for (const product of products as any[]) {
    const key = String(product.category ?? '');
    const stat = stats.get(key) ?? { total: 0, stopped: 0 };
    stat.total += 1;
    if (product.available === false) stat.stopped += 1;
    stats.set(key, stat);
  }
  const seenHub = new Set<string>();
  const rows: MenuCategoryRow[] = (categories as any[]).map((category) => {
    const stat = stats.get(idOf(category)) ?? { total: 0, stopped: 0 };
    const name = String(category.name ?? '');
    const extra = hub?.byCategory.get(normalizeCategoryName(name));
    if (extra) seenHub.add(normalizeCategoryName(name));
    const guests = guestProducts(idOf(category), name, products as any[], activeNames, hub);
    return {
      id: idOf(category),
      name,
      itemCount: stat.total + guests.length + (extra?.rows.length ?? 0),
      stoppedCount:
        stat.stopped +
        guests.filter((p) => p.available === false).length +
        (extra?.rows.filter((r) => !r.on).length ?? 0),
    };
  });
  hub?.byCategory.forEach(({ name, rows: extra }, norm) => {
    if (seenHub.has(norm)) return;
    rows.push({
      id: hubCategoryId(name),
      name,
      itemCount: extra.length,
      stoppedCount: extra.filter((r) => !r.on).length,
      hubOnly: true,
    });
  });
  return rows;
}

export async function listCategoryItems(
  categoryId: string,
  now: Date = new Date()
): Promise<MenuCategoryItems> {
  await expireMenuStops(now);

  if (isHubCategoryId(categoryId)) {
    const [hub, state] = await Promise.all([loadHubExtras(), readState()]);
    const category = hub ? findHubCategory(hub.catalog, categoryId) : null;
    const extra = category ? hub!.byCategory.get(normalizeCategoryName(category.name)) : null;
    if (!category || !extra) return { category: null, items: [] };
    const items = extra.rows.map((r) => hubItemRow(r, categoryId, state));
    return {
      category: {
        id: categoryId,
        name: category.name,
        itemCount: items.length,
        stoppedCount: items.filter((i) => !i.available).length,
        hubOnly: true,
      },
      items,
      hubSnapshotAt: hub!.catalog.takenAt,
    };
  }

  const [category, products, state, hub] = await Promise.all([
    Category.findById(categoryId).lean(),
    Product.find({ category: categoryId }).select('name category available').sort({ name: 1 }).lean(),
    readState(),
    loadHubExtras(),
  ]);
  const categoryName = String((category as any)?.name ?? '');
  // фильтр по категории повторяем в JS: гости ниже берутся из полного списка
  const items = (products as any[])
    .filter((p) => String(p?.category ?? categoryId) === categoryId)
    .map((p) => itemRow(p, state, hub));
  if (category && hub?.keysByCategory.get(normalizeCategoryName(categoryName))?.size) {
    const { all, activeNames } = await loadGuestPool();
    items.push(
      ...guestProducts(categoryId, categoryName, all, activeNames, hub).map((p) =>
        guestRow(p, categoryId, activeNames, state, hub)
      )
    );
  }
  const extra = category && hub ? hub.byCategory.get(normalizeCategoryName(categoryName)) : null;
  if (extra) items.push(...extra.rows.map((r) => hubItemRow(r, categoryId, state)));
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
    hubSnapshotAt: hub && items.some((i) => i.hubOnly || i.hub || i.guestFrom) ? hub.catalog.takenAt : null,
  };
}

/** Все товары и имена активных категорий — откуда выбираются «гости» экрана. */
async function loadGuestPool(): Promise<{ all: any[]; activeNames: Map<string, string> }> {
  const [all, categories] = await Promise.all([
    Product.find({}).select('name category available').lean(),
    Category.find({ active: true }).select('name').lean(),
  ]);
  return { all: all as any[], activeNames: namesById(categories as any[]) };
}

/**
 * Категория сайта, где позиция показана гостем (по раскладке Lieferando) —
 * чтобы кнопка, нажатая на том экране, перерисовала его же, а не унесла в
 * «родную» категорию товара. null — гостем нигде не показана.
 */
export async function hubPlacementCategoryId(productId: string): Promise<string | null> {
  if (isHubItemId(productId)) return null;
  const hub = await loadHubExtras();
  if (!hub) return null;
  const { all, activeNames } = await loadGuestPool();
  const product = all.find((p) => idOf(p) === productId);
  if (!product) return null;
  let found: string | null = null;
  activeNames.forEach((name, id) => {
    if (found) return;
    if (guestProducts(id, name, all, activeNames, hub).some((p) => idOf(p) === productId)) found = id;
  });
  return found;
}

/**
 * Позиция только на Lieferando: состояние в снимке (оптимистично — агент
 * переключит через минуту), запись бота — только в режиме «бессрочно» (утром
 * Hub включит её, и перевыключение должно знать имя); «до конца дня» ничего
 * не запоминаем: на сайте включать нечего, а Hub включит сам.
 */
async function setHubItemAvailable(
  id: string,
  available: boolean
): Promise<MenuItemRow | null> {
  const hit = await setStoredHubItemOn(id, available);
  if (!hit) return null;
  const state = await readState();
  if (available || state.mode !== 'indefinite') delete state.products[id];
  else state.products[id] = { until: null, name: hit.name };
  await writeState(state);
  return hubItemRow({ id, name: hit.name, on: available }, await hubCategoryScreenId(hit.category), state);
}

export async function setProductAvailable(
  productId: string,
  available: boolean,
  now: Date = new Date()
): Promise<MenuItemRow | null> {
  if (isHubItemId(productId)) return setHubItemAvailable(productId, available);

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
  // Команда агенту уже в пути: отмечаем позицию в снимке Hub сразу, иначе до
  // отчёта агента экран минуту показывал бы «на Lieferando состояние другое».
  await patchHubSnapshot(available, [String(product.name ?? '')]);
  return itemRow(product, state, await loadHubExtras());
}

/** Оптимистичная правка общих переключателей в снимке каталога; сбой не мешает флагу сайта. */
async function patchHubSnapshot(available: boolean, names: string[]): Promise<void> {
  if (!names.length) return;
  try {
    await patchCatalogWithResult({
      ok: true,
      action: available ? 'on' : 'off',
      target: { kind: 'item', names },
    });
  } catch {
    /* снимок поправит отчёт агента или следующий обход каталога */
  }
}

/**
 * Включает ВСЕ выключенные позиции категории (не только выключенные ботом),
 * включая Hub-строки без пары на сайте (в снимке — оптимистично).
 */
export async function enableCategoryItems(categoryId: string): Promise<MenuItemRow[]> {
  const enabled: MenuItemRow[] = [];
  const state = await readState();
  let dirty = false;

  const hub = await loadHubExtras();

  if (!isHubCategoryId(categoryId)) {
    const own = (
      (await Product.find({ category: categoryId, available: false })
        .select('name category available')
        .sort({ name: 1 })
        .lean()) as any[]
    ).filter((p) => String(p?.category ?? categoryId) === categoryId && p?.available === false);
    // гости экрана (лежат в этой категории на Lieferando) — тоже «всё в категории»
    let guests: any[] = [];
    if (hub) {
      const { all, activeNames } = await loadGuestPool();
      const categoryName = activeNames.get(categoryId) ?? '';
      guests = categoryName
        ? guestProducts(categoryId, categoryName, all, activeNames, hub).filter((p) => p?.available === false)
        : [];
    }
    const stopped = [...own, ...guests];
    if (stopped.length) {
      const ids = stopped.map(idOf);
      await Product.updateMany({ _id: { $in: ids } }, { available: true });
      for (const id of ids) delete state.products[id];
      dirty = true;
      enabled.push(...stopped.map((p) => itemRow({ ...p, available: true }, state)));
      await patchHubSnapshot(true, stopped.map((p) => String(p?.name ?? '')).filter(Boolean));
    }
  }

  if (hub) {
    const hubCategory = isHubCategoryId(categoryId)
      ? findHubCategory(hub.catalog, categoryId)?.name
      : String(((await Category.findById(categoryId).lean()) as any)?.name ?? '');
    const extra = hubCategory ? hub.byCategory.get(normalizeCategoryName(hubCategory)) : null;
    for (const row of extra?.rows.filter((r) => !r.on) ?? []) {
      if (!(await setStoredHubItemOn(row.id, true))) continue;
      delete state.products[row.id];
      dirty = true;
      enabled.push(hubItemRow({ ...row, on: true }, categoryId, state));
    }
  }

  if (dirty) await writeState(state);
  return enabled;
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
    // Hub-строки без пары на сайте: флага на сайте нет, Hub включает их сам.
    if (isHubItemId(id)) {
      delete state.products[id];
      continue;
    }
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

  // Hub-строки без пары на сайте (hub-i…): живого флага нет, Hub включает их
  // каждое утро — держим запись, пока строка есть в снимке каталога.
  const hubEntries = wanted.products.filter((p) => isHubItemId(p.id));
  const siteEntries = wanted.products.filter((p) => !isHubItemId(p.id));
  const catalog = hubEntries.length ? await getLieferandoCatalogRecord() : null;

  const variations = wanted.sizes.length
    ? ((await SizeVariation.find({ _id: { $in: wanted.sizes.map((s) => s.id) } })
        .select('name active')
        .lean()) as any[])
    : [];
  const products = siteEntries.length
    ? ((await Product.find({ _id: { $in: siteEntries.map((p) => p.id) } })
        .select('name available')
        .lean()) as any[])
    : [];
  const liveSize = new Map(variations.map((v) => [idOf(v), v]));
  const liveProduct = new Map(products.map((p) => [idOf(p), p]));
  for (const entry of hubEntries) {
    const hit = catalog ? findHubItems(catalog, entry.id) : null;
    if (hit) liveProduct.set(entry.id, { _id: entry.id, name: hit.items[0].name, available: false });
  }

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
    hubPlacementCategoryId: (id) => hubPlacementCategoryId(id),
  };
}
