/**
 * Цеха кухни — независимые «производства», которые можно останавливать отдельно.
 *
 * Их два (со слов ресторана):
 *   - `sushi` — всё MakiLove (роллы, суши-бургеры…): своя станция, свои руки;
 *   - `pizza` — пицца И прочие Beilagen (крылья, картошка, салаты…), которые
 *     к суши отношения не имеют: одна печь/фритюр, один поток.
 * Напитки и десерты не готовятся вообще — они не принадлежат ни одному цеху и
 * блокировкой цеха не задеваются.
 *
 * Файл ЧИСТЫЙ (без БД, SDK и сети) — его импортируют и сервер (/api/orders,
 * stop-бот), и клиент (checkout). Классификация позиций живёт здесь, а
 * lib/eta/order-eta.ts её переиспользует, чтобы у ETA, плана кухни и стоп-бота
 * было одно и то же понимание «что где готовится».
 */
import type { KitchenStation } from '../eta/types';

// ---------------------------------------------------------------------------
// Классификация позиции по станции кухни
// ---------------------------------------------------------------------------

const SUSHI_MARKERS = ['maki', 'sushi'];
const PIZZA_MARKERS = ['pizza', 'pizzen', 'calzone'];
const NO_PREP_MARKERS = [
  'getränk',
  'getraenk',
  'drink',
  'wasser',
  'cola',
  'fanta',
  'sprite',
  'bier',
  'wein',
  'saft',
  'dessert',
  'eis',
];

export interface ClassifiableItem {
  category?: string;
  subcategory?: string;
  name?: string;
}

/** По имени категории/подкатегории/товара решает, какая станция готовит позицию. */
export function classifyStation(item: ClassifiableItem): KitchenStation {
  const haystack = [item.category, item.subcategory, item.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!haystack) return 'fryer';

  if (SUSHI_MARKERS.some((m) => haystack.includes(m))) return 'sushi';
  if (NO_PREP_MARKERS.some((m) => haystack.includes(m))) return 'none';
  if (PIZZA_MARKERS.some((m) => haystack.includes(m))) return 'pizza';
  // Всё остальное (Beilagen, крылья, снэки, салаты…) делает «второй человек».
  return 'fryer';
}

// ---------------------------------------------------------------------------
// Цеха
// ---------------------------------------------------------------------------

export type WorkshopId = 'pizza' | 'sushi';

export const WORKSHOP_IDS: readonly WorkshopId[] = ['pizza', 'sushi'] as const;

export const WORKSHOPS: Record<
  WorkshopId,
  { id: WorkshopId; emoji: string; ru: string; de: string }
> = {
  pizza: { id: 'pizza', emoji: '🍕', ru: 'Пицца и Beilagen', de: 'Pizza & Beilagen' },
  sushi: { id: 'sushi', emoji: '🍣', ru: 'MakiLove (суши)', de: 'MakiLove (Sushi)' },
};

/** Станция → цех. Фритюр/Beilagen идут в пиццу: это те же руки, не суши. */
const STATION_TO_WORKSHOP: Record<KitchenStation, WorkshopId | null> = {
  pizza: 'pizza',
  fryer: 'pizza',
  sushi: 'sushi',
  none: null,
};

/** Цех позиции; null — готовить нечего (напитки, десерты). */
export function classifyWorkshop(item: ClassifiableItem): WorkshopId | null {
  return STATION_TO_WORKSHOP[classifyStation(item)];
}

// ---------------------------------------------------------------------------
// Состояние блокировок цехов (storeSettings.workshopsBlockedUntil)
// ---------------------------------------------------------------------------

/**
 * Ключ в storeSettings: { pizza: ISO | '', sushi: ISO | '' }.
 * Рядом живёт `ordersBlockedUntil` — ГЛОБАЛЬНЫЙ стоп всего приёма (он старше и
 * сильнее: пока он активен, не принимается ничего, независимо от цехов).
 */
export const WORKSHOP_BLOCKS_KEY = 'workshopsBlockedUntil';

export type WorkshopBlocks = Record<WorkshopId, string>;

export const EMPTY_WORKSHOP_BLOCKS: WorkshopBlocks = { pizza: '', sushi: '' };

/** Достаёт блокировки цехов из настроек магазина (мусор в БД → пусто). */
export function readWorkshopBlocks(settings: Record<string, any> | null | undefined): WorkshopBlocks {
  const raw = (settings?.[WORKSHOP_BLOCKS_KEY] ?? {}) as Record<string, unknown>;
  const blocks: WorkshopBlocks = { ...EMPTY_WORKSHOP_BLOCKS };
  for (const id of WORKSHOP_IDS) {
    const value = raw?.[id];
    blocks[id] = typeof value === 'string' ? value : '';
  }
  return blocks;
}

/** true — метка блокировки ещё не истекла. */
export function isBlockActive(until: unknown, now: Date = new Date()): boolean {
  if (typeof until !== 'string' || !until) return false;
  const time = new Date(until).getTime();
  return Number.isFinite(time) && time > now.getTime();
}

/** Какие цеха сейчас стоят. */
export function activeWorkshopBlocks(
  blocks: WorkshopBlocks,
  now: Date = new Date()
): WorkshopId[] {
  return WORKSHOP_IDS.filter((id) => isBlockActive(blocks[id], now));
}

/** Каких цехов касается корзина/заказ (без напитков и десертов). */
export function workshopsInItems(items: ClassifiableItem[] | null | undefined): WorkshopId[] {
  const found = new Set<WorkshopId>();
  for (const item of items || []) {
    const workshop = classifyWorkshop(item || {});
    if (workshop) found.add(workshop);
  }
  return WORKSHOP_IDS.filter((id) => found.has(id));
}

/**
 * Пересечение: какие ИЗ ОСТАНОВЛЕННЫХ цехов задеты этим заказом.
 * Пусто — заказ можно принимать (по цехам; глобальный стоп проверяется отдельно).
 */
export function blockedWorkshopsForItems(
  items: ClassifiableItem[] | null | undefined,
  blocks: WorkshopBlocks,
  now: Date = new Date()
): WorkshopId[] {
  const stopped = new Set(activeWorkshopBlocks(blocks, now));
  return workshopsInItems(items).filter((id) => stopped.has(id));
}

// ---------------------------------------------------------------------------
// Текст клиенту (немецкий): «слишком много заказов, попробуйте через N минут»
// ---------------------------------------------------------------------------

/** Ключ в storeSettings: шаблон сообщения, редактируется в админке. */
export const WORKSHOP_BLOCK_MESSAGE_KEY = 'workshopsBlockedMessage';

/**
 * Плейсхолдеры шаблона:
 *   {minutes} (или просто @) — сколько минут осталось до конца стопа;
 *   {workshop}               — какие позиции сейчас не готовятся;
 *   {time}                   — во сколько снова примем (HH:mm, Берлин);
 *   {alternative}            — что можно заказать вместо этого (авто).
 * Если {alternative} в шаблоне нет, подсказка добавляется в конец сама:
 * гость должен сразу понять, куда идти, а не только что «нельзя».
 */
export const DEFAULT_WORKSHOP_BLOCK_MESSAGE =
  'Wir haben aktuell zu viele Bestellungen für {workshop} – derzeit sind keine Bestellungen möglich. In ca. {minutes} Minuten nehmen wir sie wieder an. {alternative}';

/** Заголовок/кнопка: «временно не принимаем», а не «закрыто навсегда». */
export const WORKSHOP_BLOCK_HEADLINE = 'Derzeit sind keine Bestellungen möglich';

const BERLIN_TZ = 'Europe/Berlin';

/** Сколько минут осталось до конца стопа (вверх; 0 — стоп уже не активен). */
export function remainingBlockMinutes(until: unknown, now: Date = new Date()): number {
  if (!isBlockActive(until, now)) return 0;
  const diffMs = new Date(until as string).getTime() - now.getTime();
  return Math.max(1, Math.ceil(diffMs / 60_000));
}

function formatBerlinTime(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: BERLIN_TZ,
  }).format(date);
}

/** Короткая плашка на карточке: «MakiLove (Sushi) · noch 20 Min». */
export function buildWorkshopBadge(
  ids: WorkshopId[],
  blocks: WorkshopBlocks | undefined,
  now: Date = new Date()
): string {
  const labels = ids.map((id) => WORKSHOPS[id].de).join(' + ');
  const minutes = Math.max(0, ...ids.map((id) => remainingBlockMinutes(blocks?.[id] || '', now)));
  return minutes > 0 ? `${labels} · noch ${minutes} Min` : labels;
}

/**
 * Что заказать вместо этого. Гостю мало «нельзя» — сразу говорим, какой цех
 * работает: суши стоят → пицца/Beilagen/напитки, пицца стоит → суши и напитки.
 */
export function buildWorkshopAlternative(ids: WorkshopId[]): string {
  const blocked = new Set(ids);
  const open = WORKSHOP_IDS.filter((id) => !blocked.has(id));
  if (open.length === 0) {
    return 'Getränke und Desserts können Sie weiterhin bestellen.';
  }
  if (open.includes('pizza')) {
    return 'Bestellen Sie solange Pizza, Beilagen und Getränke.';
  }
  return 'Bestellen Sie solange Sushi von MakiLove und Getränke.';
}

/**
 * Сообщение гостю про остановленные цеха.
 * Минуты считаем по САМОМУ ДОЛГОМУ из задетых стопов — раньше него заказ
 * целиком всё равно не примут.
 */
export function buildWorkshopBlockMessage(
  ids: WorkshopId[],
  options: { blocks?: WorkshopBlocks; now?: Date; template?: string | null } = {}
): string {
  const now = options.now || new Date();
  const blocks = options.blocks;
  const template = (options.template || '').trim() || DEFAULT_WORKSHOP_BLOCK_MESSAGE;
  const labels = ids.map((id) => WORKSHOPS[id].de).join(' + ');

  let longest = '';
  let minutes = 0;
  for (const id of ids) {
    const until = blocks?.[id] || '';
    const left = remainingBlockMinutes(until, now);
    if (left > minutes) {
      minutes = left;
      longest = until;
    }
  }

  const alternative = buildWorkshopAlternative(ids);

  // Без известного срока «через 0 минут» звучит сломанно — говорим нейтрально.
  if (minutes <= 0) {
    return `Wir haben aktuell zu viele Bestellungen für ${labels} – derzeit sind keine Bestellungen möglich. ${alternative}`;
  }

  const filled = template
    .replace(/\{workshop\}/g, labels)
    .replace(/\{minutes\}/g, String(minutes))
    .replace(/\{time\}/g, formatBerlinTime(longest))
    .replace(/@/g, String(minutes));

  // Шаблон из админки может не знать про {alternative} — дописываем сами.
  return filled.includes('{alternative}')
    ? filled.replace(/\{alternative\}/g, alternative)
    : `${filled} ${alternative}`.trim();
}
