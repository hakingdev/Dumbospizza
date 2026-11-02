/**
 * Страховка корзины от стоп-листа: позиция (`products.available=false`) или
 * размер библиотеки (`size_variations.active=false`) могли быть выключены —
 * из стоп-бота, админки или POS — уже ПОСЛЕ того, как гость положил их в
 * корзину (она живёт в браузере сутки). Сервер такой заказ отклоняет
 * (app/api/orders: 403 с unavailableProductIds / 400 про размер); здесь —
 * чистые правила, по которым корзина и чекаут подсвечивают такие строки
 * заранее и разбирают отказ сервера на конкретные строки.
 *
 * Модуль ЧИСТЫЙ (без БД и React): его делят контекст витрины и тесты.
 * Размеры сравниваются ТОЛЬКО через normalizedSizeName — имена размеров
 * переименовывают («ca. 40x30» → «ca. 30x40»), сырой === молча теряет их.
 */
import { normalizedSizeName } from '../size-variation-state';

/** Снимок стоп-листа из GET /api/kitchen/blocks. */
export interface SoldOutSnapshot {
  /** Все товары с available=false (не только выключенные ботом). */
  soldOutProductIds: readonly string[];
  /** Нормализованные ключи (normalizedSizeName) размеров библиотеки с active=false. */
  inactiveSizeKeys: readonly string[];
}

export const EMPTY_SOLD_OUT: SoldOutSnapshot = { soldOutProductIds: [], inactiveSizeKeys: [] };

export type SoldOutReason = 'product' | 'size';

/** Минимум полей строки корзины, нужный правилу (CartItem им удовлетворяет). */
export interface SoldOutLineItem {
  id: string;
  productId?: string;
  name?: string;
  size?: { name?: string; size?: string } | null;
}

export interface SoldOutLine<T extends SoldOutLineItem = SoldOutLineItem> {
  item: T;
  reason: SoldOutReason;
}

/** Немецкие подписи строк (как весь клиентский текст). */
export const SOLD_OUT_LABELS: Record<SoldOutReason, string> = {
  product: 'Heute ausverkauft',
  size: 'Größe heute nicht verfügbar',
};

/**
 * Ключ товара строки корзины: productId, иначе id строки без суффикса «#n»
 * (дубли строк одного товара получают id вида `<productId>#2`).
 */
export function lineProductId(item: SoldOutLineItem): string {
  const raw = String(item.productId || item.id || '');
  return raw.split('#')[0];
}

/** Имя выбранного размера строки (legacy-поле `size` — запасной вариант). */
function lineSizeName(item: SoldOutLineItem): string {
  return String(item.size?.name || item.size?.size || '');
}

export function isProductSoldOut(snapshot: SoldOutSnapshot, productId: string): boolean {
  const id = String(productId || '');
  return !!id && snapshot.soldOutProductIds.includes(id);
}

export function isSizeInactive(snapshot: SoldOutSnapshot, sizeName: string): boolean {
  const key = normalizedSizeName(sizeName);
  if (!key) return false;
  return snapshot.inactiveSizeKeys.some((inactive) => normalizedSizeName(inactive) === key);
}

/** Почему строку нельзя заказать; null — можно. Товар сильнее размера. */
export function soldOutReasonFor(snapshot: SoldOutSnapshot, item: SoldOutLineItem): SoldOutReason | null {
  if (isProductSoldOut(snapshot, lineProductId(item))) return 'product';
  if (item.size && isSizeInactive(snapshot, lineSizeName(item))) return 'size';
  return null;
}

/** Строки корзины, которые сервер отклонит (в порядке корзины). */
export function soldOutLinesIn<T extends SoldOutLineItem>(
  snapshot: SoldOutSnapshot,
  items: readonly T[]
): SoldOutLine<T>[] {
  const hit: SoldOutLine<T>[] = [];
  for (const item of items || []) {
    const reason = soldOutReasonFor(snapshot, item);
    if (reason) hit.push({ item, reason });
  }
  return hit;
}

/** «Hawaiian · 36 cm» — как строка выглядит в списке баннера. */
export function soldOutLineTitle(item: SoldOutLineItem): string {
  const name = String(item.name || '').trim();
  const size = lineSizeName(item).trim();
  return size ? `${name} · ${size}` : name;
}

/** Текст блокировки для кнопок/ошибок (баннер рисует список сам). */
export function soldOutCartMessage(lines: readonly SoldOutLine[]): string {
  if (lines.length === 0) return '';
  const titles = lines.map((line) => `„${soldOutLineTitle(line.item)}“`).join(', ');
  const onlySizes = lines.every((line) => line.reason === 'size');
  const what = onlySizes
    ? lines.length > 1
      ? 'sind in dieser Größe heute nicht verfügbar'
      : 'ist in dieser Größe heute nicht verfügbar'
    : lines.length > 1
      ? 'sind heute nicht mehr verfügbar'
      : 'ist heute nicht mehr verfügbar';
  const action =
    lines.length > 1
      ? 'Bitte entfernen Sie diese Artikel aus dem Warenkorb, um fortzufahren.'
      : 'Bitte entfernen Sie den Artikel aus dem Warenkorb, um fortzufahren.';
  return `${titles} ${what}. ${action}`;
}

const SIZE_REJECTION_RE = /Gr[oö]ße\s*„([^“”"]+)[“”"]/;
const RESELECT_SIZE_RE = /für\s*„([^“”"]+)[“”"]\s*erneut eine verfügbare Größe/;

/**
 * Отказ POST /api/orders → строки корзины, о которых он говорит.
 * 403 несёт unavailableProductIds (товар снят с продажи — все его строки);
 * 400 про размер («Die Größe „36 cm“ ist nicht mehr verfügbar…») — строки с
 * этим размером; 400 «erneut eine verfügbare Größe» — строки товара без размера.
 * Любой другой ответ → [] (общая ошибка, как раньше).
 */
export function linesFromOrderRejection<T extends SoldOutLineItem>(
  items: readonly T[],
  status: number,
  body: unknown
): SoldOutLine<T>[] {
  const payload = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

  if (status === 403 && Array.isArray(payload.unavailableProductIds)) {
    const ids = new Set(payload.unavailableProductIds.map((id) => String(id)));
    return items
      .filter((item) => ids.has(lineProductId(item)))
      .map((item) => ({ item, reason: 'product' as const }));
  }

  if (status === 400 && typeof payload.error === 'string') {
    const sizeMatch = payload.error.match(SIZE_REJECTION_RE);
    if (sizeMatch) {
      const key = normalizedSizeName(sizeMatch[1]);
      return items
        .filter((item) => !!item.size && !!key && normalizedSizeName(lineSizeName(item)) === key)
        .map((item) => ({ item, reason: 'size' as const }));
    }
    const reselect = payload.error.match(RESELECT_SIZE_RE);
    if (reselect) {
      const name = reselect[1].trim();
      return items
        .filter((item) => !item.size && String(item.name || '').trim() === name)
        .map((item) => ({ item, reason: 'size' as const }));
    }
  }

  return [];
}
