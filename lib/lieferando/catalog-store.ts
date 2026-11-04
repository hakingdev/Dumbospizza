/**
 * Снимок каталога Lieferando — хранение (ключ настроек `lieferandoCatalog`) и
 * товары сайта для сверки. Чистая логика — в ./catalog; приём снимка от агента
 * с уведомлением в группу — в ./catalog-live (отдельно, чтобы menu-stop/service
 * мог читать снимок, не тянув telegram-control).
 */
import { Category } from '../models/category.model';
import { Product } from '../models/product.model';
import { getSetting, setSetting } from '../settings';
import { itemKey } from './item-key';
import {
  LIEFERANDO_CATALOG_KEY,
  applyResultToCatalog,
  findHubItems,
  readLieferandoCatalogRecord,
  setHubItemsOn,
  type LieferandoCatalogRecord,
  type SiteItem,
} from './catalog';

export async function getLieferandoCatalogRecord(): Promise<LieferandoCatalogRecord | null> {
  return readLieferandoCatalogRecord(await getSetting(LIEFERANDO_CATALOG_KEY, null));
}

export async function saveLieferandoCatalogRecord(record: LieferandoCatalogRecord): Promise<void> {
  await setSetting(LIEFERANDO_CATALOG_KEY, record);
}

const idOf = (doc: any): string => String(doc?._id ?? doc?.id ?? '');

/** Все товары сайта (и в скрытых категориях — такие пары Hub тоже «есть на сайте»). */
export async function loadSiteItems(): Promise<SiteItem[]> {
  const [products, categories] = await Promise.all([
    Product.find({}).select('name category').lean(),
    Category.find({}).select('name active').lean(),
  ]);
  const byId = new Map<string, { name: string; active: boolean }>();
  for (const c of categories as any[]) {
    byId.set(idOf(c), { name: String(c.name ?? ''), active: c.active !== false });
  }
  return (products as any[])
    .map((p) => {
      const cat = byId.get(String(p.category ?? ''));
      return {
        name: String(p.name ?? ''),
        category: cat?.name ?? '',
        visible: cat ? cat.active : false,
      };
    })
    .filter((s) => s.name);
}

/** Ключи имён всех товаров сайта — для отбора Hub-строк без пары. */
export async function loadSiteItemKeys(): Promise<Set<string>> {
  const products = (await Product.find({}).select('name').lean()) as any[];
  return new Set(products.map((p) => itemKey(p?.name)).filter(Boolean));
}

/**
 * Отчёт агента (item / makilove, ok) → общие переключатели в снимке. true —
 * снимок изменился и перезаписан.
 */
export async function patchCatalogWithResult(result: {
  ok: boolean;
  action: 'off' | 'on';
  target: { kind: string; names?: string[] };
}): Promise<boolean> {
  const record = await getLieferandoCatalogRecord();
  if (!record) return false;
  const next = applyResultToCatalog(record, result);
  if (!next) return false;
  await saveLieferandoCatalogRecord({ ...record, ...next });
  return true;
}

/**
 * Оптимистично отметить Hub-позицию (id бота) включённой/выключенной — кнопка
 * бота уже поставила агенту команду, а ждать завтрашний снимок экран не должен.
 * null — такой позиции в снимке нет.
 */
export async function setStoredHubItemOn(
  id: string,
  on: boolean
): Promise<{ category: string; name: string; on: boolean } | null> {
  const record = await getLieferandoCatalogRecord();
  if (!record) return null;
  const found = findHubItems(record, id);
  if (!found) return null;
  const next = setHubItemsOn(record, id, on);
  if (next) await saveLieferandoCatalogRecord({ ...record, ...next });
  return { category: found.category, name: found.items[0].name, on };
}
