/**
 * Подкатегории — плоские метки ВНУТРИ категории (Pizza → Rund;
 * MakiLove Sushi → Philadelphia, California, Sushi Burger).
 *
 * Сознательно НЕ дерево категорий: товар остаётся в своей категории, поэтому
 * акции (targetCategoryIds), Mews-синхронизация, группировка чеков и НДС
 * работают как раньше. Подкатегория влияет только на порядок показа в меню.
 *
 * id подкатегории стабилен: переименование метки не отвязывает товары
 * (сравнивать всегда по id, не по имени — см. историю с именами размеров).
 */
import { genObjectId } from '../db/object-id';

export interface Subcategory {
  id: string;
  name: string;
  order: number;
}

/** Категория может прийти как populate-объект, слаг-строка или null. */
type CategoryLike = { subcategories?: unknown } | string | null | undefined;

/**
 * Нормализует список подкатегорий из формы админки перед записью в БД:
 * пустые имена отбрасываются, id проставляется новым записям и дедуплицируется,
 * order переписывается по фактической позиции.
 */
export function sanitizeSubcategories(raw: unknown): Subcategory[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const result: Subcategory[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const name = String((entry as any).name ?? '').trim();
    if (!name) continue;

    let id = String((entry as any).id ?? '').trim();
    if (!id || seen.has(id)) id = genObjectId();
    seen.add(id);

    result.push({ id, name, order: result.length });
  }

  return result;
}

/** Подкатегории категории, отсортированные по order (устойчиво к «грязным» данным). */
export function readSubcategories(category: CategoryLike): Subcategory[] {
  if (!category || typeof category !== 'object') return [];
  const raw = (category as any).subcategories;
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((s: any) => s && typeof s === 'object' && s.id && s.name)
    .map((s: any, index: number) => ({
      id: String(s.id),
      name: String(s.name),
      order: typeof s.order === 'number' ? s.order : index,
    }))
    .sort((a, b) => a.order - b.order);
}

/**
 * Оставляет subcategoryId, только если такая метка есть в переданной категории.
 * Иначе null — так метка не «переезжает» вместе с товаром в другую категорию.
 */
export function resolveSubcategoryId(
  subcategories: Subcategory[],
  subcategoryId: unknown
): string | null {
  const id = typeof subcategoryId === 'string' ? subcategoryId.trim() : '';
  if (!id) return null;
  return subcategories.some((s) => s.id === id) ? id : null;
}

/**
 * Находит категорию в загруженном списке по тому, что лежит в product.category:
 * GET отдаёт populate-объект, форма редактирования — слаг, форма создания — id.
 */
export function matchCategory<T extends { _id?: string; slug?: string; name?: string }>(
  categories: T[],
  value: unknown
): T | undefined {
  const raw =
    value && typeof value === 'object'
      ? ((value as any)._id ?? (value as any).id ?? (value as any).slug ?? '')
      : value;
  const key = typeof raw === 'string' ? raw : '';
  if (!key) return undefined;
  return categories.find((c) => c._id === key || c.slug === key || c.name === key);
}

/**
 * Считает товары по подкатегориям для переключателя.
 * Ключ '' — товары без метки (и с меткой уже удалённой подкатегории).
 */
export function countBySubcategory<T>(
  products: T[],
  subcategories: Subcategory[],
  getSubcategoryId: (product: T) => string | null | undefined
): Record<string, number> {
  const known = new Set(subcategories.map((s) => s.id));
  const counts: Record<string, number> = {};

  for (const product of products) {
    const raw = getSubcategoryId(product);
    const key = raw && known.has(raw) ? raw : '';
    counts[key] = (counts[key] || 0) + 1;
  }

  return counts;
}

export interface SubcategoryGroup<T> {
  /** null — товары без метки (показываются первыми, без заголовка) */
  id: string | null;
  name: string;
  products: T[];
}

/**
 * Делит товары категории на группы по подкатегориям в порядке, заданном рестораном.
 * Пустые группы отбрасываются; товары с меткой удалённой подкатегории попадают
 * в безымянную группу, а не пропадают.
 */
export function groupBySubcategory<T>(
  products: T[],
  subcategories: Subcategory[],
  getSubcategoryId: (product: T) => string | null | undefined
): SubcategoryGroup<T>[] {
  if (subcategories.length === 0) {
    return products.length > 0 ? [{ id: null, name: '', products }] : [];
  }

  const known = new Map<string, T[]>(subcategories.map((s) => [s.id, []]));
  const untagged: T[] = [];

  for (const product of products) {
    const id = getSubcategoryId(product);
    const bucket = id ? known.get(id) : undefined;
    if (bucket) bucket.push(product);
    else untagged.push(product);
  }

  const groups: SubcategoryGroup<T>[] = [];
  if (untagged.length > 0) groups.push({ id: null, name: '', products: untagged });
  for (const sub of subcategories) {
    const items = known.get(sub.id) || [];
    if (items.length > 0) groups.push({ id: sub.id, name: sub.name, products: items });
  }

  return groups;
}
