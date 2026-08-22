/**
 * AI-оценка времени заказа через Claude API: сколько готовить и везти.
 *
 * Модель кухни (со слов ресторана):
 *   - пицца: один пиццайоло, ~8 мин на пиццу;
 *   - фритюр/Beilagen (крылья, картошка и пр.): второй человек, ~8 мин на
 *     позицию, работает ПАРАЛЛЕЛЬНО с пиццей;
 *   - суши (категория MakiLove): своя станция, 2 человека, ~8 мин на позицию
 *     на человека (две позиции одновременно);
 *   - напитки/десерты: не готовятся.
 *   - подряд идущие заказы не делаются вплотную: между ними 15–20 мин
 *     (возврат курьера, ёмкость печи);
 *   - самая дальняя доставка ~25 мин в одну сторону; адреса объединяются в
 *     маршрут от ближнего к дальнему, если они «по пути».
 *
 * Claude получает новый заказ + очередь активных заказов + геоданные и отдаёт
 * строгий JSON (structured outputs). При любом сбое — детерминированный
 * эвристический fallback, чтобы клиент в любом случае получил время.
 *
 * Ключ ANTHROPIC_API_KEY живёт только на сервере (.env.local / Vercel env).
 */

import Anthropic from '@anthropic-ai/sdk';
import { Order } from '../models/order.model';
import { getSetting } from '../settings';
import { restaurantLocation } from '../seed-products';
import { geocodeAddress } from '../delivery/geocode';
import { resolveRoadDistanceKm } from '../delivery/road-distance';
import { normalizeDetourFactor } from '../delivery/detour';
import { classifyStation } from '../kitchen/workshops';
import type {
  EtaLoadLevel,
  KitchenStaffing,
  KitchenStation,
  OrderEtaAnalysis,
  OrderGeoAnalysis,
} from './types';

export type { KitchenStaffing, OrderEtaAnalysis, OrderGeoAnalysis } from './types';

// ---------------------------------------------------------------------------
// Персонал на смене (меняется селекторами в панели AI-плана кухни)
// ---------------------------------------------------------------------------

/** Ключ настройки «персонал кухни на смене». */
export const KITCHEN_STAFFING_KEY = 'kitchenStaffing';

/** Дефолт = исходная модель со слов ресторана: повар + помощник + 2 суши. */
export const DEFAULT_STAFFING: KitchenStaffing = {
  pizzaCooks: 1,
  fryerHelpers: 1,
  sushiChefs: 2,
};

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
};

/** Настройка из БД может быть мусором — приводим к безопасным диапазонам. */
export function normalizeStaffing(value: unknown): KitchenStaffing {
  const v = (value ?? {}) as Partial<KitchenStaffing>;
  return {
    pizzaCooks: clampInt(v.pizzaCooks, 1, 4, DEFAULT_STAFFING.pizzaCooks),
    fryerHelpers: clampInt(v.fryerHelpers, 0, 3, DEFAULT_STAFFING.fryerHelpers),
    sushiChefs: clampInt(v.sushiChefs, 1, 4, DEFAULT_STAFFING.sushiChefs),
  };
}

/**
 * Модель кухни для промптов (общая для оценки времени и плана кухни).
 * Меняется вместе с персоналом на смене.
 */
export function buildKitchenModelLines(staffing: KitchenStaffing): string[] {
  const { pizzaCooks, fryerHelpers, sushiChefs } = staffing;
  const lines = [
    pizzaCooks > 1
      ? `PIZZA station: ${pizzaCooks} cooks, ~8 minutes per pizza per cook — up to ${pizzaCooks} pizzas in parallel.`
      : 'PIZZA station: one cook, ~8 minutes per pizza on average, pizzas are made one after another.',
    fryerHelpers > 0
      ? `FRYER/sides station ("fryer"): ${fryerHelpers} helper(s) make Beilagen, wings, fries, snacks etc., ~8 minutes per item each. Works IN PARALLEL with the pizza station.`
      : 'FRYER/sides: NO separate helper right now — the pizza cook(s) also make Beilagen/wings/fries themselves, each side item ADDS ~8 minutes to the pizza station workload (no parallelism between pizza and sides).',
    `SUSHI station (MakiLove category: rolls, sushi burgers, ...): ${sushiChefs} ${
      sushiChefs > 1 ? 'people' : 'person'
    }, ~8 minutes per item per person${
      sushiChefs > 1 ? `, so ${sushiChefs} items in parallel` : ''
    }. Independent of pizza/fryer.`,
    'Drinks and desserts need no preparation.',
    'This staffing is what the staff set for the CURRENT shift (it changes during the day) — respect it, do not assume more hands.',
  ];
  return lines;
}

// ---------------------------------------------------------------------------
// Классификация позиций по станциям кухни
// ---------------------------------------------------------------------------

/**
 * Живёт в lib/kitchen/workshops.ts (чистый файл без БД/SDK): ту же классификацию
 * использует стоп-бот и чекаут, когда останавливают отдельный цех.
 * Реэкспорт — чтобы не менять существующих потребителей ETA.
 */
export { classifyStation };

export interface StationUnits {
  pizza: number;
  fryer: number;
  sushi: number;
}

/** Количество готовящихся единиц по станциям (с учётом quantity). */
export function computeStationUnits(
  items: Array<{ category?: string; subcategory?: string; name?: string; quantity?: number }>
): StationUnits {
  const units: StationUnits = { pizza: 0, fryer: 0, sushi: 0 };
  for (const item of items || []) {
    const qty = Math.max(1, Number(item.quantity) || 1);
    const station = classifyStation(item);
    if (station !== 'none') units[station] += qty;
  }
  return units;
}

// ---------------------------------------------------------------------------
// Детерминированная эвристика (и fallback, и «подсказки» для AI)
// ---------------------------------------------------------------------------

const MINUTES_PER_UNIT = 8;
/** Между подряд идущими заказами всегда есть зазор (со слов ресторана 15–20 мин). */
const QUEUE_GAP_MINUTES = 15;

/**
 * Чистое время готовки заказа с учётом персонала на смене.
 * Станции работают параллельно; без помощника гарнир делает сам повар
 * (добавляется к его очереди пицц).
 */
export function heuristicPrepMinutes(
  units: StationUnits,
  staffing: KitchenStaffing = DEFAULT_STAFFING
): number {
  let pizza: number;
  let fryer: number;
  if (staffing.fryerHelpers > 0) {
    pizza = Math.ceil(units.pizza / staffing.pizzaCooks) * MINUTES_PER_UNIT;
    fryer = Math.ceil(units.fryer / staffing.fryerHelpers) * MINUTES_PER_UNIT;
  } else {
    // Помощника нет: пицца и гарнир — одни руки, последовательно.
    pizza = Math.ceil((units.pizza + units.fryer) / staffing.pizzaCooks) * MINUTES_PER_UNIT;
    fryer = 0;
  }
  const sushi = Math.ceil(units.sushi / Math.max(1, staffing.sushiChefs)) * MINUTES_PER_UNIT;
  const prep = Math.max(pizza, fryer, sushi);
  return prep > 0 ? Math.max(prep, 10) : 5;
}

/** Оценка времени в пути в одну сторону по дорожному расстоянию. */
export function driveMinutesFromKm(km: number): number {
  // Со слов ресторана: по городу ~50 км/ч, за городом 70–100 км/ч (считаем ~85).
  // Первые 3 км — городские, дальше трасса; ~3 мин на выезд/парковку/передачу.
  // Пример: 1.5 км ≈ 5 мин (никак не 20); дальняя зона 16 км ≈ 16 мин.
  const cityKm = Math.min(km, 3);
  const highwayKm = Math.max(0, km - 3);
  const drivingMinutes = (cityKm / 50 + highwayKm / 85) * 60;
  return Math.min(20, Math.max(4, Math.round(3 + drivingMinutes)));
}

/** Округление обещания клиенту до 5 минут вверх. */
export function roundEtaTo5(minutes: number): number {
  return Math.ceil(minutes / 5) * 5;
}

// ---------------------------------------------------------------------------
// Контекст: очередь активных заказов + геоданные нового адреса
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES = ['new', 'preparing', 'ready_for_delivery', 'delivering'] as const;
/** Заказы старше этого возраста в очередь не берём (зависшие статусы). */
const QUEUE_LOOKBACK_MS = 3 * 60 * 60 * 1000;

interface QueueOrderContext {
  orderNumber: string;
  status: string;
  minutesAgo: number;
  deliveryType: 'delivery' | 'pickup';
  address?: string;
  units: StationUnits;
  itemCount: number;
  promisedEtaMinutes?: number;
  /** Сколько минут осталось от обещанного клиенту времени. */
  promiseRemainingMinutes?: number;
  distanceKm?: number;
  coordinates?: { lat: number; lng: number };
  desiredDeliveryTime?: string;
}

/**
 * Готовый заказ: работы у плиты больше нет, но курьер ещё занят.
 * Полей меньше, чем у очереди, намеренно — станции и время готовки для
 * приготовленного заказа не значат ничего, и модель не должна их видеть.
 */
interface CookedOrderContext {
  orderNumber: string;
  status: string;
  minutesAgo: number;
  deliveryType: 'delivery' | 'pickup';
  address?: string;
  distanceKm?: number;
  coordinates?: { lat: number; lng: number };
}

export interface EtaContext {
  nowBerlin: string;
  restaurantAddress: string;
  /** Персонал на смене (настройка из панели плана кухни). */
  staffing: KitchenStaffing;
  newOrder: {
    orderNumber: string;
    deliveryType: 'delivery' | 'pickup';
    address?: string;
    desiredDeliveryTime?: string;
    items: Array<{ name: string; quantity: number; station: KitchenStation }>;
    units: StationUnits;
    prepMinutesEstimate: number;
    distanceKm?: number;
    driveMinutesEstimate?: number;
    coordinates?: { lat: number; lng: number };
  };
  /** Очередь НА КУХНЮ: заказы, которые ещё предстоит готовить. */
  queue: QueueOrderContext[];
  /**
   * Заказы, которые уже приготовлены: ждут курьера (ready_for_delivery) или
   * едут (delivering). Кухне они работы не добавляют — влияют только на
   * занятость курьера и на то, можно ли увезти новый заказ тем же рейсом.
   */
  cooked: CookedOrderContext[];
}

function formatAddress(order: any): string | undefined {
  if (order.deliveryType !== 'delivery' || !order.deliveryAddress) return undefined;
  const a = order.deliveryAddress;
  return `${a.street} ${a.houseNumber}, ${a.postalCode} ${a.city}`.trim();
}

function berlinNowString(now = new Date()): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
}

/** Геокод + дорожное расстояние для адреса доставки (best effort, с кэшами внутри provider'ов). */
async function resolveOrderGeo(
  order: any,
  storeSettings: Record<string, any>
): Promise<{ distanceKm?: number; coordinates?: { lat: number; lng: number } }> {
  const address = formatAddress(order);
  if (!address) return {};
  try {
    const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    const restaurantAddress = storeSettings?.address || restaurantLocation.address;
    const fullAddress = address.includes('Germany') ? address : `${address}, Germany`;

    const [restaurantGeo, coords] = await Promise.all([
      geocodeAddress(restaurantAddress, googleMapsApiKey).catch(() => null),
      geocodeAddress(fullAddress, googleMapsApiKey).catch(() => null),
    ]);
    if (!coords) return {};

    const road = await resolveRoadDistanceKm(
      restaurantGeo ?? { lat: restaurantLocation.lat, lng: restaurantLocation.lng },
      coords,
      {
        googleApiKey: storeSettings?.googleMapsApiKey || googleMapsApiKey,
        detourFactor: normalizeDetourFactor(storeSettings?.deliveryDetourFactor),
      }
    ).catch(() => null);

    return {
      distanceKm: road ? Math.round(road.km * 10) / 10 : undefined,
      coordinates: { lat: coords.lat, lng: coords.lng },
    };
  } catch {
    return {};
  }
}

/** Заказ приготовлен: ждёт курьера или уже едет. Кухне работы не добавляет. */
export function isCookedStatus(status: unknown): boolean {
  return status === 'ready_for_delivery' || status === 'delivering';
}

/**
 * Активные заказы → две очереди, и это главное в оценке.
 *
 * Работу кухне добавляют только те, кого ещё готовят (new/preparing). Заказ,
 * отданный курьеру, у плиты не занимает никого — но раньше он приезжал в промпт
 * одним списком с готовящимися, вместе со станциями и временем готовки. Модель
 * честно считала его работой впереди и накидывала гостю время за еду, которая
 * давно готова. Эвристика (heuristicEta) так не ошибалась — расходились два
 * пути одной и той же оценки, а до гостя доходил тот, что ошибался.
 */
export function splitActiveQueue(
  activeOrders: any[],
  opts: { excludeId?: string; now?: number } = {}
): { queue: QueueOrderContext[]; cooked: CookedOrderContext[] } {
  const now = opts.now ?? Date.now();
  const queue: QueueOrderContext[] = [];
  const cooked: CookedOrderContext[] = [];

  for (const o of activeOrders) {
    const id = String(o._id ?? o.id ?? '');
    if (opts.excludeId && id === opts.excludeId) continue;

    const createdMs = new Date(o.createdAt).getTime();
    const minutesAgo = Math.max(0, Math.round((now - createdMs) / 60_000));

    if (isCookedStatus(o.status)) {
      cooked.push({
        orderNumber: o.orderNumber,
        status: o.status,
        minutesAgo,
        deliveryType: o.deliveryType,
        address: formatAddress(o),
        distanceKm: o.etaAnalysis?.distanceKm,
        coordinates: o.etaAnalysis?.coordinates,
      });
      continue;
    }

    const promised = o.etaMinutes ?? undefined;
    const etaSetMs = o.etaSetAt ? new Date(o.etaSetAt).getTime() : createdMs;
    queue.push({
      orderNumber: o.orderNumber,
      status: o.status,
      minutesAgo,
      deliveryType: o.deliveryType,
      address: formatAddress(o),
      units: computeStationUnits(o.items || []),
      itemCount: (o.items || []).reduce(
        (sum: number, it: any) => sum + (Number(it.quantity) || 1),
        0
      ),
      promisedEtaMinutes: promised,
      promiseRemainingMinutes:
        promised != null ? Math.round(promised - (now - etaSetMs) / 60_000) : undefined,
      distanceKm: o.etaAnalysis?.distanceKm,
      coordinates: o.etaAnalysis?.coordinates,
      desiredDeliveryTime: o.desiredDeliveryTime || undefined,
    });
  }

  return { queue, cooked };
}

/** Собирает контекст для оценки: новый заказ + активная очередь + геоданные. */
export async function buildEtaContext(order: any): Promise<EtaContext> {
  const [storeSettings, staffingSetting] = await Promise.all([
    getSetting<Record<string, any>>('storeSettings', {}),
    getSetting<KitchenStaffing>(KITCHEN_STAFFING_KEY, DEFAULT_STAFFING),
  ]);
  const staffing = normalizeStaffing(staffingSetting);

  const units = computeStationUnits(order.items || []);
  const geo = await resolveOrderGeo(order, storeSettings || {});

  const since = new Date(Date.now() - QUEUE_LOOKBACK_MS);
  let activeOrders: any[] = [];
  try {
    activeOrders = await Order.find({
      status: { $in: [...ACTIVE_STATUSES] },
      createdAt: { $gte: since },
    }).sort({ createdAt: 1 });
  } catch (e) {
    console.error('[eta] queue lookup failed:', (e as Error)?.message);
  }

  const { queue, cooked } = splitActiveQueue(activeOrders, {
    excludeId: String(order._id ?? order.id ?? ''),
  });

  return {
    nowBerlin: berlinNowString(),
    restaurantAddress: storeSettings?.address || restaurantLocation.address,
    staffing,
    newOrder: {
      orderNumber: order.orderNumber,
      deliveryType: order.deliveryType,
      address: formatAddress(order),
      desiredDeliveryTime: order.desiredDeliveryTime || undefined,
      items: (order.items || []).map((it: any) => ({
        name: it.name,
        quantity: Math.max(1, Number(it.quantity) || 1),
        station: classifyStation(it),
      })),
      units,
      prepMinutesEstimate: heuristicPrepMinutes(units, staffing),
      distanceKm: geo.distanceKm,
      driveMinutesEstimate:
        geo.distanceKm != null ? driveMinutesFromKm(geo.distanceKm) : undefined,
      coordinates: geo.coordinates,
    },
    queue,
    cooked,
  };
}

// ---------------------------------------------------------------------------
// Эвристический fallback (когда AI недоступен)
// ---------------------------------------------------------------------------

export function heuristicEta(context: EtaContext): OrderEtaAnalysis {
  const { newOrder, queue } = context;
  // В очереди на кухню — только ещё не приготовленные заказы.
  const cooking = queue.filter((o) => o.status === 'new' || o.status === 'preparing');
  const queuePenalty = Math.min(cooking.length, 4) * QUEUE_GAP_MINUTES;

  const prepMinutes = newOrder.prepMinutesEstimate + queuePenalty;
  const driveMinutes =
    newOrder.deliveryType === 'delivery'
      ? newOrder.driveMinutesEstimate ?? driveMinutesFromKm(6) // без геоданных считаем среднюю зону
      : 0;
  // +5 мин на упаковку/передачу курьеру.
  const deliveryMinutes = driveMinutes > 0 ? driveMinutes + 5 : 0;

  const total = roundEtaTo5(prepMinutes + deliveryMinutes);
  const loadLevel: EtaLoadLevel =
    cooking.length >= 6 ? 'peak' : cooking.length >= 3 ? 'busy' : 'normal';

  return {
    etaMinutes: Math.min(Math.max(total, newOrder.deliveryType === 'delivery' ? 25 : 15), 150),
    prepMinutes,
    deliveryMinutes,
    distanceKm: newOrder.distanceKm,
    driveMinutes: driveMinutes || undefined,
    loadLevel,
    advisory:
      loadLevel === 'peak'
        ? `В очереди ${cooking.length} заказов — кухня перегружена. Рекомендую приостановить приём на 30–60 мин (стоп-бот) или объявлять время от ${Math.max(total, 90)} мин.`
        : null,
    routeHint: null,
    reasoning: `Эвристика: готовка ${newOrder.prepMinutesEstimate} мин + очередь ${queuePenalty} мин + доставка ${deliveryMinutes} мин.`,
    source: 'heuristic',
    queueSize: queue.length,
    coordinates: newOrder.coordinates,
  };
}

// ---------------------------------------------------------------------------
// AI-оценка через Claude (structured outputs)
// ---------------------------------------------------------------------------

const ETA_SCHEMA = {
  type: 'object',
  properties: {
    etaMinutes: {
      type: 'integer',
      description:
        'Total minutes from NOW that we promise the customer (prep incl. queue + delivery for delivery orders; ready-for-pickup time for pickup). Round to a multiple of 5.',
    },
    prepMinutes: {
      type: 'integer',
      description: 'Minutes until the food is ready, incl. waiting for orders ahead in the queue',
    },
    deliveryMinutes: {
      type: 'integer',
      description: 'Minutes for the delivery leg incl. handover (0 for pickup)',
    },
    loadLevel: { type: 'string', enum: ['normal', 'busy', 'peak'] },
    advisory: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description:
        'Staff recommendation in RUSSIAN when load is busy/peak (pause intake 30/60 min via stop-bot, or shift promises); null when normal',
    },
    routeHint: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description:
        'TERSE route instruction in RUSSIAN, max ~12 words, no explanations: which order to ride with and stop sequence (e.g. "С #123: сначала Würzburger 20, потом Prinzengraben"); null if nothing to combine',
    },
    reasoning: {
      type: 'string',
      description: 'One-two sentences in RUSSIAN explaining the estimate for the staff',
    },
  },
  required: [
    'etaMinutes',
    'prepMinutes',
    'deliveryMinutes',
    'loadLevel',
    'advisory',
    'routeHint',
    'reasoning',
  ],
  additionalProperties: false,
} as const;

function buildEtaSystemPrompt(staffing: KitchenStaffing): string {
  return `You are the kitchen dispatcher of "Dumbos Pizza", Kurhausstr. 11A, 97688 Bad Kissingen, Germany.
For every NEW order you estimate when the customer will get it, given the current queue.

Kitchen model (staffing set by the staff for the current shift):
${buildKitchenModelLines(staffing)
  .map((l) => `- ${l}`)
  .join('\n')}
- Back-to-back orders are NOT started immediately one after another: there is always a 15-20 minute spacing between consecutive orders (driver turnaround, oven capacity). Apply this when several orders are queued.
- ACTIVE QUEUE lists ONLY orders that still have to be cooked. ALREADY COOKED lists orders that are finished (waiting for the driver or already on the road): they cost the kitchen ZERO time, never add spacing for them and never count them as work ahead of this order. Use them only to judge driver availability and to combine trips.

Delivery model:
- PICKUP orders (deliveryType "pickup"): etaMinutes is ONLY the preparation time incl. queue — when the food is ready at the counter. deliveryMinutes MUST be 0; never add driver or road time.
- Use "distanceKm" / "driveMinutesEstimate" when provided and do NOT inflate them. Driving speeds (owner's numbers): ~50 km/h in town, 70-100 km/h outside town. A 1.5 km address is ~5 minutes door to door, 10 minutes absolute maximum; the farthest zone (~16 km) is ~15-20 minutes one way.
- A delivery round trip blocks the driver for roughly 2x the one-way time. Assume ONE driver on the road unless the queue clearly implies more.
- Combine deliveries that go in the same direction (compare coordinates/addresses of pending deliveries): order stops from nearest to farthest. If this order should ride together with a queued order, say so in "routeHint" (mention the other order number).
- If the customer chose a Wunschzeit (desiredDeliveryTime, HH:mm local time) later than your natural estimate, promise the Wunschzeit instead (etaMinutes = minutes from now until that time).

Output rules:
- etaMinutes is the promise to the customer measured FROM NOW. Be realistic and slightly pessimistic: arriving earlier than promised is fine, later is not. Round to a multiple of 5. Typical range: 20-45 min quiet, 60-120 min at peak.
- "loadLevel": "peak" when the kitchen cannot keep its promises with the current queue (roughly 6+ orders cooking or promises slipping), "busy" when it is tight, otherwise "normal".
- "advisory" (RUSSIAN, for the staff, null when normal): at busy/peak recommend concretely — e.g. after how many more orders to pause intake, or to pause for 30/60 minutes via the stop-bot, or by how much to shift promised times.
- "advisory", "routeHint", "reasoning" are in Russian.
- "routeHint" is a TERSE instruction for the kitchen, not an explanation. Format: what to do, in what order — nothing else. Good: "С #L-GRCR8J: сначала Würzburger 20, потом Prinzengraben". Bad: any sentence explaining WHY, distances in brackets, or notes about other trips. Max ~12 words. If nothing to combine — null, not prose.
- Do not invent orders, distances or times that are not in the data.`;
}

export async function analyzeEtaWithClaude(context: EtaContext): Promise<OrderEtaAnalysis> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  // Оценка идёт в критическом пути ответа чекаута → жёсткий таймаут, без ретраев.
  const client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 0 });

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 4000,
    // low effort: важна задержка — заказ ждёт подтверждения
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: ETA_SCHEMA as any },
    },
    system: buildEtaSystemPrompt(context.staffing),
    messages: [
      {
        role: 'user',
        content: [
          `Current local time: ${context.nowBerlin}`,
          `Kitchen staff on shift: ${context.staffing.pizzaCooks} pizza cook(s), ${context.staffing.fryerHelpers} fryer helper(s), ${context.staffing.sushiChefs} sushi chef(s)`,
          '',
          'NEW ORDER (estimate this one):',
          JSON.stringify(context.newOrder, null, 2),
          '',
          `ACTIVE QUEUE — still to cook (${context.queue.length} orders, oldest first):`,
          JSON.stringify(context.queue, null, 2),
          '',
          `ALREADY COOKED — no kitchen work left, driver only (${context.cooked.length}):`,
          JSON.stringify(context.cooked, null, 2),
        ].join('\n'),
      },
    ],
  } as any);

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined the request');
  }

  const textBlock = response.content.find((block: any) => block.type === 'text') as
    | { type: 'text'; text: string }
    | undefined;
  if (!textBlock?.text) throw new Error('Empty response from Claude');

  const raw = JSON.parse(textBlock.text) as Partial<OrderEtaAnalysis>;
  return normalizeEtaVerdict(raw, context);
}

/**
 * Валидация и нормализация ответа модели. Инвариант самовывоза жёсткий:
 * deliveryMinutes = 0, а если модель всё же вплела дорогу в etaMinutes —
 * вычитаем её, чтобы клиенту не обещали лишнее время.
 */
export function normalizeEtaVerdict(
  raw: Partial<OrderEtaAnalysis>,
  context: EtaContext
): OrderEtaAnalysis {
  if (
    !Number.isFinite(raw.etaMinutes) ||
    !Number.isFinite(raw.prepMinutes) ||
    !Number.isFinite(raw.deliveryMinutes)
  ) {
    throw new Error('Malformed ETA verdict');
  }

  const isPickup = context.newOrder.deliveryType === 'pickup';
  let etaMinutes = Number(raw.etaMinutes);
  let deliveryMinutes = Math.max(0, Math.round(Number(raw.deliveryMinutes)));
  const prepMinutes = Math.max(0, Math.round(Number(raw.prepMinutes)));

  if (isPickup && deliveryMinutes > 0) {
    etaMinutes -= deliveryMinutes;
    deliveryMinutes = 0;
  }
  // Самовывоз = только изготовление: обещание не может превышать prep-часть.
  if (isPickup) {
    etaMinutes = Math.min(etaMinutes, Math.max(prepMinutes, 10));
  }
  etaMinutes = Math.min(Math.max(roundEtaTo5(etaMinutes), 10), 180);

  return {
    etaMinutes,
    prepMinutes,
    deliveryMinutes,
    distanceKm: isPickup ? undefined : context.newOrder.distanceKm,
    driveMinutes: isPickup ? undefined : context.newOrder.driveMinutesEstimate,
    loadLevel: (['normal', 'busy', 'peak'] as const).includes(raw.loadLevel as any)
      ? (raw.loadLevel as EtaLoadLevel)
      : 'normal',
    advisory: typeof raw.advisory === 'string' && raw.advisory.trim() ? raw.advisory.trim() : null,
    routeHint:
      typeof raw.routeHint === 'string' && raw.routeHint.trim() ? raw.routeHint.trim() : null,
    reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : undefined,
    source: 'ai',
    model: 'claude-opus-5',
    queueSize: context.queue.length,
    coordinates: context.newOrder.coordinates,
  };
}

// ---------------------------------------------------------------------------
// Точки входа
// ---------------------------------------------------------------------------

/**
 * Гео-обогащение при поступлении заказа: расстояние/координаты в etaAnalysis,
 * БЕЗ оценки времени и без etaMinutes/etaSetAt. Никогда не бросает.
 *
 * Автоматическая оценка времени (estimateAndApplyOrderEta ниже) при приёме
 * заказа ВЫКЛЮЧЕНА по решению ресторана: время готовности называет кухня с
 * прибора (экран «Zeit festlegen»), а не ИИ. Геоданные же нужны всегда —
 * ими план кухни (kitchen-plan) собирает рейсы курьера.
 */
export async function applyOrderGeo(order: any): Promise<OrderGeoAnalysis | null> {
  try {
    const storeSettings = await getSetting<Record<string, any>>('storeSettings', {});
    const geo = await resolveOrderGeo(order, storeSettings || {});
    if (geo.distanceKm == null && !geo.coordinates) return null;

    const analysis: OrderGeoAnalysis = {
      source: 'geo',
      distanceKm: geo.distanceKm,
      driveMinutes: geo.distanceKm != null ? driveMinutesFromKm(geo.distanceKm) : undefined,
      coordinates: geo.coordinates,
    };
    order.etaAnalysis = analysis;
    await order.save();
    return analysis;
  } catch (e) {
    console.error('[eta] geo enrichment failed:', e);
    return null;
  }
}

/**
 * Считает ETA (AI → эвристика), записывает на заказ (etaMinutes/etaSetAt/
 * etaAnalysis) и сохраняет. Никогда не бросает — сбой оценки не должен
 * ломать размещение заказа. Возвращает null только при полном сбое.
 *
 * СЕЙЧАС НЕ ВЫЗЫВАЕТСЯ автоматически: время ставит кухня с прибора вручную.
 * Оставлена намеренно — план ресторана вернуть авторасчёт как AI-подсказку
 * на приборе (кнопка на экране выбора времени), когда до этого дойдёт.
 */
export async function estimateAndApplyOrderEta(order: any): Promise<OrderEtaAnalysis | null> {
  try {
    const context = await buildEtaContext(order);

    let analysis: OrderEtaAnalysis;
    try {
      analysis = await analyzeEtaWithClaude(context);
    } catch (e) {
      console.error('[eta] AI estimate failed, falling back to heuristic:', (e as Error)?.message);
      analysis = heuristicEta(context);
    }

    order.etaMinutes = analysis.etaMinutes;
    order.etaSetAt = new Date();
    order.etaAnalysis = analysis;
    await order.save();

    console.log(
      `[eta] order=${order.orderNumber} eta=${analysis.etaMinutes}min ` +
        `(prep=${analysis.prepMinutes}, delivery=${analysis.deliveryMinutes}, ` +
        `load=${analysis.loadLevel}, source=${analysis.source}, queue=${analysis.queueSize})`
    );
    return analysis;
  } catch (e) {
    console.error('[eta] estimation failed entirely:', e);
    return null;
  }
}
