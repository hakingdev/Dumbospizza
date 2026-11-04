/**
 * Сверка каталога Lieferando Partner Hub с сайтом — ЧИСТАЯ часть (без БД).
 *
 * Агент (scripts/lieferando/core.mjs runCatalog) раз в сутки снимает все
 * категории Hub: имя строки, общий переключатель, варианты — и шлёт снимок на
 * app/api/lieferando/agent/catalog. Здесь снимок:
 *   - читается из произвольного JSON (readLieferandoCatalog — мусор не роняет);
 *   - сверяется с товарами сайта той же нормализацией, что у агента
 *     (itemKey из ./item-key — точная копия core.mjs):
 *       hubOnly    — строки Hub без пары на сайте (Burger, «Neu: Sushi Balls…»):
 *                    бот показывает их в «📋 Позиции» с пометкой 🛵 и переключает
 *                    только на Lieferando;
 *       mismatches — товар сайта, у которого в Hub нет точной пары, но есть
 *                    похожая строка («Tiger-Drache» ↔ «Tiger-Drache 340g»):
 *                    бот такой товар на Lieferando не переключит — надо
 *                    выровнять имя;
 *     товары только на сайте (алкоголь, воды, Mini Pizza Box) — норма, молчим;
 *   - сравнивается с прошлым снимком/сверкой (catalogChanges): в группу уходит
 *     ТОЛЬКО новое — появившееся в Hub без пары, пропавшее из Hub, новые
 *     несовпадения имён, впервые не открывшиеся категории. Без изменений —
 *     тишина.
 *
 * Хранится в ключе настроек `lieferandoCatalog` (LieferandoCatalogRecord):
 * сам снимок + ключи прошлой сверки, чтобы не повторять одно и то же каждое
 * утро. Строки не открывшихся категорий подставляются из прошлого снимка
 * (mergeFailedCategories) — иначе они выглядели бы «пропавшими», а назавтра
 * «новыми».
 *
 * Для экрана бота у Hub-позиции короткий стабильный id — hub-i<fnv1a(itemKey)>
 * (callback_data Telegram ≤ 64 байт): строки с одним ключом («X» и «X (rund)»)
 * агент всё равно переключает вместе, поэтому и в боте они одна кнопка.
 */
import { itemKey } from './item-key';

export const LIEFERANDO_CATALOG_KEY = 'lieferandoCatalog';

export interface CatalogVariation {
  text: string;
  on: boolean;
}

export interface CatalogItem {
  name: string;
  on: boolean;
  variations: CatalogVariation[];
}

export interface CatalogCategory {
  name: string;
  items: CatalogItem[];
}

export interface LieferandoCatalog {
  takenAt: string;
  categories: CatalogCategory[];
  /** категории, которые агент не смог открыть (строки — из прошлого снимка) */
  failedCategories: string[];
}

/** Что лежит в ключе настроек: снимок + итог прошлой сверки. */
export interface LieferandoCatalogRecord extends LieferandoCatalog {
  receivedAt: string;
  /** ключи (itemKey) строк Hub без пары на сайте по прошлой сверке */
  hubOnlyKeys: string[];
  /** пары «ключ сайта~ключ Hub», о которых уже предупреждали */
  mismatchKeys: string[];
}

/** Товар сайта для сверки; visible — категория активна (такие товары бот показывает). */
export interface SiteItem {
  name: string;
  category: string;
  visible: boolean;
}

const MAX_CATEGORIES = 200;
const MAX_ITEMS = 500;
const MAX_VARIATIONS = 30;
const MAX_NAME = 120;

const str = (v: unknown, max = MAX_NAME): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

const strings = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.map((s) => str(s)).filter(Boolean).slice(0, max) : [];

const validIso = (v: unknown): v is string => typeof v === 'string' && !isNaN(Date.parse(v));

/** Снимок из произвольного JSON (тело запроса агента / БД). Пустой или мусор → null. */
export function readLieferandoCatalog(
  raw: unknown,
  fallbackTakenAt: string = new Date().toISOString()
): LieferandoCatalog | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  if (!Array.isArray(r.categories)) return null;
  const categories: CatalogCategory[] = [];
  for (const c of r.categories.slice(0, MAX_CATEGORIES)) {
    const name = str(c?.name);
    if (!name) continue;
    const items: CatalogItem[] = [];
    for (const i of Array.isArray(c.items) ? c.items.slice(0, MAX_ITEMS) : []) {
      const itemName = str(i?.name);
      if (!itemName) continue;
      const variations: CatalogVariation[] = [];
      for (const v of Array.isArray(i.variations) ? i.variations.slice(0, MAX_VARIATIONS) : []) {
        // агент шлёт { text, on }; допускаем и голую строку (ручной снимок)
        const text = str(typeof v === 'string' ? v : v?.text);
        if (text) variations.push({ text, on: typeof v === 'string' ? true : v?.on !== false });
      }
      items.push({ name: itemName, on: i.on !== false, variations });
    }
    categories.push({ name, items });
  }
  if (!categories.length) return null;
  return {
    takenAt: validIso(r.takenAt) ? r.takenAt : fallbackTakenAt,
    categories,
    failedCategories: strings(r.failedCategories, MAX_CATEGORIES),
  };
}

export function readLieferandoCatalogRecord(raw: unknown): LieferandoCatalogRecord | null {
  const base = readLieferandoCatalog(raw, '');
  if (!base || !base.takenAt) return null;
  const r = raw as Record<string, any>;
  return {
    ...base,
    receivedAt: validIso(r.receivedAt) ? r.receivedAt : base.takenAt,
    hubOnlyKeys: strings(r.hubOnlyKeys, 2000),
    mismatchKeys: strings(r.mismatchKeys, 2000),
  };
}

// --- короткие id для кнопок бота -------------------------------------------------

export const HUB_ITEM_PREFIX = 'hub-i';
export const HUB_CATEGORY_PREFIX = 'hub-c';

/** FNV-1a 32 бит → 8 hex: стабильный короткий хэш для callback_data. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** id Hub-позиции для бота — по ключу имени: «X» и «X (rund)» — одна кнопка. */
export const hubItemId = (name: string): string => `${HUB_ITEM_PREFIX}${fnv1a(itemKey(name))}`;

export const normalizeCategoryName = (name: string): string =>
  name.toLowerCase().replace(/\s+/g, ' ').trim();

/** id виртуальной категории бота (категория Hub, которой нет на сайте). */
export const hubCategoryId = (name: string): string =>
  `${HUB_CATEGORY_PREFIX}${fnv1a(normalizeCategoryName(name))}`;

export const isHubItemId = (id: string): boolean => id.startsWith(HUB_ITEM_PREFIX);
export const isHubCategoryId = (id: string): boolean => id.startsWith(HUB_CATEGORY_PREFIX);
export const isHubId = (id: string): boolean => isHubItemId(id) || isHubCategoryId(id);

/** Категория снимка по id бота. */
export function findHubCategory(catalog: LieferandoCatalog, id: string): CatalogCategory | null {
  return catalog.categories.find((c) => hubCategoryId(c.name) === id) ?? null;
}

/** Все строки снимка с этим id (один ключ имени) и категория первой из них. */
export function findHubItems(
  catalog: LieferandoCatalog,
  id: string
): { category: string; items: CatalogItem[] } | null {
  let category = '';
  const items: CatalogItem[] = [];
  for (const c of catalog.categories) {
    for (const i of c.items) {
      if (hubItemId(i.name) !== id) continue;
      if (!category) category = c.name;
      items.push(i);
    }
  }
  return items.length ? { category, items } : null;
}

/** Новый снимок, где у всех строк с этим id общий переключатель = on; null — таких строк нет. */
export function setHubItemsOn(catalog: LieferandoCatalog, id: string, on: boolean): LieferandoCatalog | null {
  let found = false;
  const categories = catalog.categories.map((c) => ({
    ...c,
    items: c.items.map((i) => {
      if (hubItemId(i.name) !== id) return i;
      found = true;
      return { ...i, on };
    }),
  }));
  return found ? { ...catalog, categories } : null;
}

// --- сверка с сайтом -------------------------------------------------------------

export interface HubOnlyItem {
  category: string;
  name: string;
  on: boolean;
  key: string;
}

export interface NameMismatch {
  site: string;
  hub: string;
  /** «ключ сайта~ключ Hub» — чтобы не предупреждать повторно */
  key: string;
}

export interface CatalogReport {
  hubOnly: HubOnlyItem[];
  mismatches: NameMismatch[];
  /** строк Hub с парой на сайте */
  matched: number;
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i + 1 < s.length; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Коэффициент Дайса по биграммам: 1 — одинаковые, 0 — ничего общего. */
export function nameSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let common = 0;
  ga.forEach((n, g) => {
    common += Math.min(n, gb.get(g) ?? 0);
  });
  return (2 * common) / (a.length - 1 + (b.length - 1));
}

/** Порог «это, похоже, одна позиция с разным написанием». */
export const MISMATCH_THRESHOLD = 0.75;

/** «tigerdrache» ⊂ «tigerdrache340g» — тоже похоже, даже если Дайс ниже порога. */
function mismatchScore(a: string, b: string): number {
  const dice = nameSimilarity(a, b);
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 4 && long.includes(short)) return Math.max(dice, MISMATCH_THRESHOLD);
  return dice;
}

/**
 * Сверка снимка с товарами сайта. hubOnly — строки Hub без пары (уникальные по
 * ключу); mismatches — видимые товары сайта без точной пары, но с похожей
 * строкой Hub (жадно по убыванию похожести, каждая строка — не больше одного
 * раза); такие строки Hub из hubOnly убираются — о них скажет предупреждение.
 */
export function reconcileCatalog(catalog: LieferandoCatalog, siteItems: SiteItem[]): CatalogReport {
  const siteKeys = new Map<string, SiteItem>();
  for (const s of siteItems) {
    const key = itemKey(s.name);
    if (key && !siteKeys.has(key)) siteKeys.set(key, s);
  }

  const hubByKey = new Map<string, HubOnlyItem>();
  let matched = 0;
  for (const c of catalog.categories) {
    for (const i of c.items) {
      const key = itemKey(i.name);
      if (!key) continue;
      if (siteKeys.has(key)) {
        matched += 1;
        continue;
      }
      const prev = hubByKey.get(key);
      if (prev) prev.on = prev.on && i.on;
      else hubByKey.set(key, { category: c.name, name: i.name, on: i.on, key });
    }
  }

  const hubKeys = new Set<string>();
  for (const c of catalog.categories) for (const i of c.items) hubKeys.add(itemKey(i.name));
  const siteUnmatched = siteItems.filter((s) => s.visible && !hubKeys.has(itemKey(s.name)));

  const hubOnlyAll = Array.from(hubByKey.values());
  const candidates: Array<{ site: SiteItem; hub: HubOnlyItem; score: number }> = [];
  for (const site of siteUnmatched) {
    const sKey = itemKey(site.name);
    for (const hub of hubOnlyAll) {
      const score = mismatchScore(sKey, hub.key);
      if (score >= MISMATCH_THRESHOLD) candidates.push({ site, hub, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const usedSite = new Set<string>();
  const usedHub = new Set<string>();
  const mismatches: NameMismatch[] = [];
  for (const { site, hub } of candidates) {
    const sKey = itemKey(site.name);
    if (usedSite.has(sKey) || usedHub.has(hub.key)) continue;
    usedSite.add(sKey);
    usedHub.add(hub.key);
    mismatches.push({ site: site.name, hub: hub.name, key: `${sKey}~${hub.key}` });
  }

  return {
    hubOnly: hubOnlyAll.filter((h) => !usedHub.has(h.key)),
    mismatches,
    matched,
  };
}

// --- что изменилось с прошлого раза ----------------------------------------------

export interface CatalogChanges {
  newHubOnly: HubOnlyItem[];
  gone: Array<{ category: string; name: string }>;
  newMismatches: NameMismatch[];
  newFailedCategories: string[];
}

export function catalogChanges(
  prev: LieferandoCatalogRecord | null,
  current: LieferandoCatalog,
  report: CatalogReport
): CatalogChanges {
  const prevHubOnly = new Set(prev?.hubOnlyKeys ?? []);
  const prevMismatch = new Set(prev?.mismatchKeys ?? []);
  const prevFailed = new Set(prev?.failedCategories ?? []);

  const gone: CatalogChanges['gone'] = [];
  if (prev) {
    const currentKeys = new Set<string>();
    for (const c of current.categories) for (const i of c.items) currentKeys.add(itemKey(i.name));
    const seen = new Set<string>();
    for (const c of prev.categories) {
      for (const i of c.items) {
        const key = itemKey(i.name);
        if (!key || currentKeys.has(key) || seen.has(key)) continue;
        seen.add(key);
        gone.push({ category: c.name, name: i.name });
      }
    }
  }

  return {
    newHubOnly: report.hubOnly.filter((h) => !prevHubOnly.has(h.key)),
    gone,
    newMismatches: report.mismatches.filter((m) => !prevMismatch.has(m.key)),
    newFailedCategories: current.failedCategories.filter((c) => !prevFailed.has(c)),
  };
}

export const hasCatalogChanges = (c: CatalogChanges): boolean =>
  c.newHubOnly.length > 0 ||
  c.gone.length > 0 ||
  c.newMismatches.length > 0 ||
  c.newFailedCategories.length > 0;

/**
 * Не открывшиеся у агента категории берём из прошлого снимка: их строки не
 * пропали, их просто не удалось прочитать.
 */
export function mergeFailedCategories(
  current: LieferandoCatalog,
  prev: LieferandoCatalog | null
): LieferandoCatalog {
  if (!prev || !current.failedCategories.length) return current;
  const have = new Set(current.categories.map((c) => normalizeCategoryName(c.name)));
  const carried: CatalogCategory[] = [];
  for (const name of current.failedCategories) {
    const norm = normalizeCategoryName(name);
    if (have.has(norm)) continue;
    const old = prev.categories.find((c) => normalizeCategoryName(c.name) === norm);
    if (old) {
      carried.push(old);
      have.add(norm);
    }
  }
  return carried.length ? { ...current, categories: [...current.categories, ...carried] } : current;
}

/** Запись для хранения: снимок + ключи этой сверки. */
export function buildCatalogRecord(
  catalog: LieferandoCatalog,
  report: CatalogReport,
  receivedAt: string
): LieferandoCatalogRecord {
  return {
    ...catalog,
    receivedAt,
    hubOnlyKeys: report.hubOnly.map((h) => h.key),
    mismatchKeys: report.mismatches.map((m) => m.key),
  };
}

// --- сводка в группу ---------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const formatTime = (iso: string, timeZone = 'Europe/Berlin'): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone }).format(d);
};

/** Текст в группу стоп-бота (parse_mode HTML) — только изменения. */
export function formatCatalogSummary(
  changes: CatalogChanges,
  catalog: LieferandoCatalog,
  timeZone = 'Europe/Berlin'
): string {
  const count = catalog.categories.reduce((n, c) => n + c.items.length, 0);
  const lines = [
    `🛵📋 <b>Сверка каталога Lieferando</b> — ${formatTime(catalog.takenAt, timeZone)}, ` +
      `категорий: ${catalog.categories.length}, позиций: ${count}`,
  ];

  if (changes.newHubOnly.length) {
    lines.push('', '🆕 <b>Новое на Lieferando, нет на сайте:</b>');
    const byCategory = new Map<string, string[]>();
    for (const h of changes.newHubOnly) {
      const list = byCategory.get(h.category) ?? [];
      list.push(h.name + (h.on ? '' : ' (выкл)'));
      byCategory.set(h.category, list);
    }
    byCategory.forEach((names, category) => lines.push(`• ${esc(category)}: ${esc(names.join(', '))}`));
    lines.push('В боте они в «📋 Позиции» с пометкой 🛵 — переключаются только на Lieferando.');
  }

  if (changes.gone.length) {
    lines.push('', `➖ <b>Пропало из Lieferando:</b> ${esc(changes.gone.map((g) => g.name).join(', '))}`);
  }

  if (changes.newMismatches.length) {
    lines.push('', '⚠️ <b>Имена не совпадают — бот не переключит на Lieferando:</b>');
    for (const m of changes.newMismatches) lines.push(`• ${esc(m.site)} ↔ ${esc(m.hub)}`);
    lines.push('Слева — как на сайте, справа — как в Hub. Выровняйте имя на одной из сторон.');
  }

  if (changes.newFailedCategories.length) {
    lines.push(
      '',
      `⚠️ Не открылись категории: ${esc(changes.newFailedCategories.join(', '))} — их строки взяты из прошлого снимка.`
    );
  }
  return lines.join('\n');
}

/** Сообщение о сбое снимка (сессия истекла, Hub лёг). */
export function formatCatalogFailure(error: string, reason?: string): string {
  const when = reason === 'daily' ? 'Ежедневный снимок' : 'Снимок';
  return `🛵❌ ${when} каталога Lieferando не удался.\n${esc(error || 'Причина неизвестна.')}\nПроверьте агента на VDS (journalctl -fu lieferando-agent).`;
}

// --- актуализация снимка по отчётам агента ------------------------------------------

/**
 * Отчёт агента о переключении (item / makilove, ok) — обновляем общие
 * переключатели в снимке, чтобы экран бота не ждал завтрашнего снимка.
 * Размеры (variations) бот не показывает — не трогаем. null — ничего не изменилось.
 */
export function applyResultToCatalog(
  catalog: LieferandoCatalog,
  result: { ok: boolean; action: 'off' | 'on'; target: { kind: string; names?: string[] } }
): LieferandoCatalog | null {
  if (!result.ok) return null;
  const on = result.action === 'on';
  let hit: (category: string, item: CatalogItem) => boolean;
  if (result.target.kind === 'item') {
    const keys = new Set((result.target.names ?? []).map(itemKey).filter(Boolean));
    if (!keys.size) return null;
    hit = (_c, i) => keys.has(itemKey(i.name));
  } else if (result.target.kind === 'makilove') {
    const maki = (s: string) => /makilove/i.test(s.replace(/\s+/g, ''));
    hit = (c, i) => maki(c) || maki(i.name);
  } else {
    return null;
  }
  let changed = false;
  const categories = catalog.categories.map((c) => ({
    ...c,
    items: c.items.map((i) => {
      if (i.on === on || !hit(c.name, i)) return i;
      changed = true;
      return { ...i, on };
    }),
  }));
  return changed ? { ...catalog, categories } : null;
}

// --- строки для экрана бота ----------------------------------------------------------

export interface HubOnlyRow {
  id: string;
  name: string;
  on: boolean;
}

/**
 * Hub-строки без пары на сайте, по категориям Hub (имя категории → строки),
 * одна строка на ключ имени. siteKeys — ключи всех товаров сайта.
 */
export function hubOnlyByCategory(
  catalog: LieferandoCatalog,
  siteKeys: Set<string>
): Map<string, HubOnlyRow[]> {
  const out = new Map<string, HubOnlyRow[]>();
  for (const c of catalog.categories) {
    const rows = new Map<string, HubOnlyRow>();
    for (const i of c.items) {
      const key = itemKey(i.name);
      if (!key || siteKeys.has(key)) continue;
      const id = hubItemId(i.name);
      const prev = rows.get(id);
      if (prev) prev.on = prev.on && i.on;
      else rows.set(id, { id, name: i.name, on: i.on });
    }
    if (rows.size) out.set(c.name, Array.from(rows.values()));
  }
  return out;
}
