/**
 * AI-план кухни: в какой последовательности готовить активные заказы и как
 * группировать доставки по рейсам курьера.
 *
 * Пример: в очереди 2 заказа в Oerlenbach и 1 в Bad Kissingen → готовить оба
 * Oerlenbach'а вместе (один рейс курьера), затем Bad Kissingen. Claude смотрит
 * на адреса/координаты/расстояния всех активных заказов и отдаёт строгий JSON
 * с шагами. При сбое AI — детерминированная эвристика (группировка по городу).
 *
 * ✏️  КАК ПРАВИТЬ ЛОГИКУ (для будущих изменений):
 *   1. buildDispatchRules() — правила диспетчеризации обычным текстом
 *      (по-английски, это промпт для Claude). Добавь/поменяй строку —
 *      поведение AI изменится. Числа бери из PLAN_TUNING, чтобы эвристика
 *      не разъехалась.
 *   2. PLAN_TUNING — числовые ручки (заказов на рейс, радиус «одного города»
 *      и т.д.). Их использует И промпт, И эвристика-fallback.
 *   3. heuristicKitchenPlan() — запасной план без AI; если добавляешь новое
 *      правило в buildDispatchRules, подумай, нужно ли оно и здесь.
 *
 * Число курьеров на смене — НЕ константа: персонал меняет его селектором в
 * панели плана (настройка kitchenPlanCourierCount в БД, см. COURIER_COUNT_KEY);
 * PLAN_TUNING.courierCount — только значение по умолчанию.
 *
 * Ключ ANTHROPIC_API_KEY живёт только на сервере (.env.local / Vercel env).
 */

import Anthropic from '@anthropic-ai/sdk';
import { Order } from '../models/order.model';
import { getSetting } from '../settings';
import { restaurantLocation } from '../seed-products';
import {
  computeStationUnits,
  heuristicPrepMinutes,
  driveMinutesFromKm,
  buildKitchenModelLines,
  isCookedStatus,
  normalizeStaffing,
  KITCHEN_STAFFING_KEY,
  DEFAULT_STAFFING,
  StationUnits,
} from './order-eta';
import type {
  EtaLoadLevel,
  KitchenPlan,
  KitchenPlanBatch,
  KitchenPlanLateOrder,
  KitchenStaffing,
} from './types';

export type { KitchenPlan, KitchenPlanBatch, KitchenPlanLateOrder } from './types';

// ---------------------------------------------------------------------------
// ✏️ НАСТРОЙКИ — правь здесь
// ---------------------------------------------------------------------------

/** Числовые ручки плана. Используются и в промпте, и в эвристике. */
export const PLAN_TUNING = {
  /** Максимум заказов, которые курьер увозит одним рейсом. */
  maxOrdersPerTrip: 3,
  /** Курьеров на смене ПО УМОЛЧАНИЮ — актуальное число ставят в панели плана. */
  courierCount: 1,
  /** Адреса ближе этого радиуса (км по прямой) считаем «одним направлением», даже если города разные. */
  sameDirectionRadiusKm: 3,
  /** Осталось меньше этого от обещания клиенту (мин) → заказ срочный, двигать в начало. */
  urgentPromiseMinutes: 20,
  /** Пауза между запусками готовки подряд идущих рейсов (мин) — возврат курьера/ёмкость печи. */
  prepGapMinutes: 15,
  /** С этого числа готовящихся заказов считаем «busy», с большего — «peak». */
  busyAtOrders: 3,
  peakAtOrders: 6,
  /**
   * Осталось меньше этого от обещания (мин) → заказ попадает в lateOrders:
   * панель/бот предлагают отправить гостю WhatsApp «заказ опаздывает на +N мин».
   */
  lateSoonMinutes: 5,
} as const;

/** Ключ настройки «курьеров на смене» (ставится селектором в панели плана). */
export const COURIER_COUNT_KEY = 'kitchenPlanCourierCount';

/** Курьеров на смене: целое 1…6, мусор → дефолт из PLAN_TUNING. */
export function normalizeCourierCount(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1 || n > 6) return PLAN_TUNING.courierCount;
  return n;
}

/**
 * Правила диспетчеризации — промпт для Claude, по одному правилу на строку.
 * Пиши по-английски (модель стабильнее следует), выводы она делает по-русски.
 */
export function buildDispatchRules(courierCount: number): string[] {
  return [
  `Group deliveries that go to the SAME town or lie within ~${PLAN_TUNING.sameDirectionRadiusKm} km of each other (compare "city", coordinates and distanceKm) into one courier trip: cook them together, deliver in one run from nearest to farthest.`,
  `A courier takes at most ${PLAN_TUNING.maxOrdersPerTrip} orders per trip. There are ${courierCount} courier(s) on shift right now: up to ${courierCount} trip(s) can be on the road at the same time. With several couriers, far and near trips can run in parallel — use that to keep promises.`,
  `Orders whose promise to the customer is about to expire (promiseRemainingMinutes < ${PLAN_TUNING.urgentPromiseMinutes}) are urgent: schedule them in the earliest possible step, even if that breaks a nice geographic grouping.`,
  `Prefer finishing a far-away trip (e.g. Oerlenbach, Bad Bocklet) as a complete package: it is better to cook 2 Oerlenbach orders together and send the courier once than to drive the same road twice.`,
  `While all couriers are away, the kitchen should cook the orders for the NEXT trip (e.g. local Bad Kissingen addresses) so they are ready when a courier returns. Keep ~${PLAN_TUNING.prepGapMinutes} min spacing between starting consecutive trips per courier.`,
  `Pickup orders (deliveryType "pickup") do not need a courier: slot them into the cooking sequence by their promise time, never into a courier trip.`,
  `Orders already "ready_for_delivery" are cooked: only assign them to a courier trip (possibly together with orders still cooking for the same direction).`,
  `Orders "delivering" are already on the road: exclude them from steps, they only mean a courier is busy right now.`,
  `Respect Wunschzeit (desiredDeliveryTime): do not cook an order scheduled for later ahead of urgent immediate orders.`,
  `Trust "driveMinutesEstimate" and do NOT inflate drive times. Speeds (owner's numbers): ~50 km/h in town, 70-100 km/h outside. A 1.5 km address is ~5 min door to door (10 min absolute max); the farthest zone (~16 km) is ~15-20 min one way.`,
  `Do not invent orders, addresses or distances that are not in the data.`,
  ];
}

// ---------------------------------------------------------------------------
// Контекст: активные заказы с геоданными (без внешних вызовов — берём то,
// что уже посчитал ETA-движок при оформлении заказа)
// ---------------------------------------------------------------------------

/** Эти статусы попадают в план (готовить/везти). delivering — только как «курьер занят». */
export const PLAN_STATUSES = ['new', 'preparing', 'ready_for_delivery', 'delivering'] as const;
/** Заказы старше этого возраста не берём (зависшие статусы). */
const PLAN_LOOKBACK_MS = 3 * 60 * 60 * 1000;

/** Станции приготовленного заказа свободны — работы у плиты не осталось. */
const EMPTY_UNITS: StationUnits = { pizza: 0, fryer: 0, sushi: 0 };

export interface PlanOrderContext {
  /** id заказа в БД — для действий из панели (не отправляется в промпт). */
  id?: string;
  orderNumber: string;
  /** Канал заказа: сайт (по умолчанию) или чек Lieferando. */
  source?: 'website' | 'lieferando';
  /** Есть ли телефон гостя — нужен для WhatsApp о задержке (не отправляется в промпт). */
  hasPhone?: boolean;
  status: string;
  minutesAgo: number;
  deliveryType: 'delivery' | 'pickup';
  address?: string;
  city?: string;
  items: string[];
  units: StationUnits;
  prepMinutesEstimate: number;
  promisedEtaMinutes?: number;
  /** Сколько минут осталось от обещанного клиенту времени (может быть < 0). */
  promiseRemainingMinutes?: number;
  distanceKm?: number;
  driveMinutesEstimate?: number;
  coordinates?: { lat: number; lng: number };
  desiredDeliveryTime?: string;
}

export interface KitchenPlanContext {
  nowBerlin: string;
  restaurantAddress: string;
  /** Курьеров на смене (настройка из панели, дефолт PLAN_TUNING.courierCount). */
  courierCount: number;
  /** Персонал кухни на смене (настройка из панели, дефолт DEFAULT_STAFFING). */
  staffing: KitchenStaffing;
  orders: PlanOrderContext[];
  /** Номера заказов в пути (курьер занят). */
  onTheRoad: string[];
}

function berlinNowString(now = new Date()): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
}

/** Город для группировки: без регистра/лишних пробелов. */
export function normalizeCity(city: unknown): string {
  return String(city ?? '')
    .trim()
    .toLocaleLowerCase('de-DE')
    .replace(/\s+/g, ' ');
}

/** Собирает контекст плана из активных заказов. Геоданные — из etaAnalysis заказа. */
export async function buildKitchenPlanContext(): Promise<KitchenPlanContext> {
  const [storeSettings, courierSetting, staffingSetting] = await Promise.all([
    getSetting<Record<string, any>>('storeSettings', {}),
    getSetting<number>(COURIER_COUNT_KEY, PLAN_TUNING.courierCount),
    getSetting<KitchenStaffing>(KITCHEN_STAFFING_KEY, DEFAULT_STAFFING),
  ]);
  const staffing = normalizeStaffing(staffingSetting);
  const since = new Date(Date.now() - PLAN_LOOKBACK_MS);

  let activeOrders: any[] = [];
  try {
    activeOrders = await Order.find({
      status: { $in: [...PLAN_STATUSES] },
      createdAt: { $gte: since },
    }).sort({ createdAt: 1 });
  } catch (e) {
    console.error('[kitchen-plan] queue lookup failed:', (e as Error)?.message);
  }

  const now = Date.now();
  const orders: PlanOrderContext[] = [];
  const onTheRoad: string[] = [];

  for (const o of activeOrders) {
    if (o.status === 'delivering') {
      onTheRoad.push(o.orderNumber);
      continue;
    }
    const createdMs = new Date(o.createdAt).getTime();
    const promised = o.etaMinutes ?? undefined;
    const etaSetMs = o.etaSetAt ? new Date(o.etaSetAt).getTime() : createdMs;
    // Приготовленному заказу нужен только курьер: станции у него свободны, и
    // время готовки — ноль. Иначе правило «ready_for_delivery уже готов» в
    // промпте спорит с цифрами в тех же данных, а спор модель решает по цифрам.
    const cooked = isCookedStatus(o.status);
    const units = cooked ? EMPTY_UNITS : computeStationUnits(o.items || []);
    const addr = o.deliveryType === 'delivery' ? o.deliveryAddress : undefined;
    const distanceKm = o.etaAnalysis?.distanceKm;

    orders.push({
      id: String(o._id ?? o.id ?? ''),
      orderNumber: o.orderNumber,
      source: o.source === 'lieferando' ? 'lieferando' : 'website',
      hasPhone: Boolean(String(o.phoneNumber ?? '').trim()),
      status: o.status,
      minutesAgo: Math.max(0, Math.round((now - createdMs) / 60_000)),
      deliveryType: o.deliveryType,
      address: addr
        ? `${addr.street} ${addr.houseNumber}, ${addr.postalCode} ${addr.city}`.trim()
        : undefined,
      city: addr?.city || undefined,
      items: (o.items || []).map(
        (it: any) => `${Math.max(1, Number(it.quantity) || 1)}x ${it.name}`
      ),
      units,
      prepMinutesEstimate: cooked ? 0 : heuristicPrepMinutes(units, staffing),
      promisedEtaMinutes: promised,
      promiseRemainingMinutes:
        promised != null ? Math.round(promised - (now - etaSetMs) / 60_000) : undefined,
      distanceKm,
      driveMinutesEstimate: distanceKm != null ? driveMinutesFromKm(distanceKm) : undefined,
      coordinates: o.etaAnalysis?.coordinates,
      desiredDeliveryTime: o.desiredDeliveryTime || undefined,
    });
  }

  return {
    nowBerlin: berlinNowString(),
    restaurantAddress: storeSettings?.address || restaurantLocation.address,
    courierCount: normalizeCourierCount(courierSetting),
    staffing,
    orders,
    onTheRoad,
  };
}

// ---------------------------------------------------------------------------
// Опаздывающие заказы: считаются детерминированно (не AI) и прикладываются
// к плану — панель и Telegram-бот рисуют по ним кнопки «опаздывает на +N мин»
// ---------------------------------------------------------------------------

/** Заказы, у которых обещание просрочено или истекает (≤ lateSoonMinutes). */
export function computeLateOrders(context: KitchenPlanContext): KitchenPlanLateOrder[] {
  const late: KitchenPlanLateOrder[] = [];
  for (const o of context.orders) {
    const remaining = o.promiseRemainingMinutes;
    if (remaining == null || remaining > PLAN_TUNING.lateSoonMinutes) continue;
    late.push({
      orderId: o.id ?? '',
      orderNumber: o.orderNumber,
      source: o.source === 'lieferando' ? 'lieferando' : 'website',
      minutesLate: Math.max(0, -remaining),
      promiseRemainingMinutes: remaining,
      hasPhone: o.hasPhone ?? true,
    });
  }
  // Сильнее всего просроченные — первыми.
  late.sort((a, b) => b.minutesLate - a.minutesLate);
  return late;
}

// ---------------------------------------------------------------------------
// Эвристический fallback (когда AI недоступен): группировка по городу,
// срочные — вперёд
// ---------------------------------------------------------------------------

/** Срочность заказа: чем меньше, тем раньше готовить. Без обещания — по возрасту. */
function urgencyOf(o: PlanOrderContext): number {
  if (o.promiseRemainingMinutes != null) return o.promiseRemainingMinutes;
  // Нет обещания (телефонный заказ и т.п.) — считаем «осталось 45 минут минус возраст».
  return 45 - o.minutesAgo;
}

export function heuristicKitchenPlan(context: KitchenPlanContext): KitchenPlan {
  const cooking = context.orders;
  const deliveries = cooking.filter((o) => o.deliveryType === 'delivery');
  const pickups = cooking.filter((o) => o.deliveryType === 'pickup');

  // Доставки группируем по городу; рейс не больше maxOrdersPerTrip заказов.
  const byCity = new Map<string, PlanOrderContext[]>();
  for (const o of deliveries) {
    const key = normalizeCity(o.city) || 'unbekannt';
    const list = byCity.get(key) ?? [];
    list.push(o);
    byCity.set(key, list);
  }

  interface Draft {
    orders: PlanOrderContext[];
    area: string;
    isPickup: boolean;
    urgency: number;
  }
  const drafts: Draft[] = [];

  for (const group of Array.from(byCity.values())) {
    group.sort((a, b) => urgencyOf(a) - urgencyOf(b));
    for (let i = 0; i < group.length; i += PLAN_TUNING.maxOrdersPerTrip) {
      const chunk = group.slice(i, i + PLAN_TUNING.maxOrdersPerTrip);
      drafts.push({
        orders: chunk,
        area: chunk[0].city || 'Unbekannt',
        isPickup: false,
        urgency: Math.min(...chunk.map(urgencyOf)),
      });
    }
  }
  for (const o of pickups) {
    drafts.push({ orders: [o], area: 'Abholung', isPickup: true, urgency: urgencyOf(o) });
  }

  drafts.sort((a, b) => a.urgency - b.urgency);

  const batches: KitchenPlanBatch[] = drafts.map((d, idx) => {
    // Внутри рейса адреса от ближнего к дальнему (курьер едет «по пути»).
    const stops = [...d.orders].sort(
      (a, b) => (a.distanceKm ?? 99) - (b.distanceKm ?? 99)
    );
    return {
      step: idx + 1,
      orderNumbers: stops.map((o) => o.orderNumber),
      area: d.area,
      cookTogether: stops.length > 1,
      courier: d.isPickup
        ? null
        : `Рейс: ${d.area}, ${stops.length} адрес${stops.length > 1 ? 'а' : ''}${
            stops.length > 1 ? ' (от ближнего к дальнему)' : ''
          }`,
      rationale: d.isPickup
        ? 'Самовывоз — готовить к обещанному времени, курьер не нужен.'
        : stops.length > 1
          ? `Один город (${d.area}) — готовить вместе и везти одним рейсом.`
          : `Единственный заказ в направлении ${d.area}.`,
    };
  });

  const cookingCount = cooking.filter((o) => o.status !== 'ready_for_delivery').length;
  const loadLevel: EtaLoadLevel =
    cookingCount >= PLAN_TUNING.peakAtOrders
      ? 'peak'
      : cookingCount >= PLAN_TUNING.busyAtOrders
        ? 'busy'
        : 'normal';

  return {
    batches,
    lateOrders: computeLateOrders(context),
    summary:
      batches.length === 0
        ? 'Активных заказов нет.'
        : `Эвристика: ${batches.length} шаг(ов), доставки сгруппированы по городам, срочные — первыми.`,
    advisory:
      loadLevel === 'peak'
        ? `Готовится ${cookingCount} заказов — кухня перегружена. Рассмотри паузу приёма (стоп-бот) на 30–60 мин.`
        : null,
    loadLevel,
    source: 'heuristic',
    queueSize: context.orders.length,
    onTheRoad: context.onTheRoad,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// AI-план через Claude (structured outputs)
// ---------------------------------------------------------------------------

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    batches: {
      type: 'array',
      description: 'Steps in execution order: what to cook (together) and which courier trip.',
      items: {
        type: 'object',
        properties: {
          step: { type: 'integer', description: '1-based position, 1 = do first' },
          orderNumbers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Order numbers in this step; for a courier trip list stops nearest first',
          },
          area: {
            type: 'string',
            description: 'Town/direction label ("Oerlenbach", "Bad Kissingen Zentrum"); "Abholung" for pickups',
          },
          cookTogether: {
            type: 'boolean',
            description: 'true when the orders of this step should be cooked simultaneously',
          },
          courier: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description:
              'Courier trip description in RUSSIAN ("рейс №1: Oerlenbach, 2 адреса, от ближнего к дальнему"); null for pickup steps',
          },
          rationale: {
            type: 'string',
            description:
              'TERSE RUSSIAN instruction, max ~8 words, no "because"/"так как": what to do (e.g. "Готовить вместе, один рейс"). Empty string if the step is self-evident',
          },
        },
        required: ['step', 'orderNumbers', 'area', 'cookTogether', 'courier', 'rationale'],
        additionalProperties: false,
      },
    },
    summary: {
      type: 'string',
      description: '1-2 RUSSIAN sentences for the staff: the essence of the plan',
    },
    advisory: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description:
        'RUSSIAN staff recommendation at busy/peak (pause intake via stop-bot, shift promises); null when normal',
    },
    loadLevel: { type: 'string', enum: ['normal', 'busy', 'peak'] },
  },
  required: ['batches', 'summary', 'advisory', 'loadLevel'],
  additionalProperties: false,
} as const;

function buildSystemPrompt(courierCount: number, staffing: KitchenStaffing): string {
  return `You are the kitchen dispatcher of "Dumbos Pizza", Kurhausstr. 11A, 97688 Bad Kissingen, Germany.
You receive ALL active orders (queue) with addresses, coordinates, road distances and promise timers.
Orders come from two sales channels (field "source"): "website" — the restaurant's own site, and
"lieferando" — receipts from the Lieferando marketplace scanned by the staff (their numbers start with "L-").
Treat both channels equally when sequencing and routing; mention the channel in "summary"/"rationale"
when it helps the staff (e.g. "заказ с Lieferando").
Produce the optimal execution plan: in which sequence to cook the orders and how to combine deliveries into courier trips.

Kitchen model (staffing set by the staff for the current shift):
${buildKitchenModelLines(staffing)
  .map((l) => `- ${l}`)
  .join('\n')}
- "units" per order = items per station; "prepMinutesEstimate" = net cooking time of that order alone (already accounts for the staffing above).

Dispatch rules:
${buildDispatchRules(courierCount)
  .map((r) => `- ${r}`)
  .join('\n')}

Output rules:
- Every order from the queue (except status "delivering") must appear in EXACTLY ONE batch. Never drop or duplicate an order.
- Steps are ordered by execution: step 1 = start cooking first.
- "summary", "advisory", "rationale", "courier" are in RUSSIAN.
- These texts are TERSE instructions, not explanations: what to do, with which order numbers/towns — never WHY. "rationale" max ~8 words, "summary" max ~15 words, "courier" is just the trip (town + stop sequence). No justifications, no distances in brackets.
- "loadLevel": "peak" when the kitchen cannot keep its promises with the current queue, "busy" when tight, else "normal".`;
}

export async function analyzeKitchenPlanWithClaude(
  context: KitchenPlanContext
): Promise<KitchenPlan> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  // Панель админки ждёт ответ синхронно → таймаут, без ретраев.
  const client = new Anthropic({ apiKey, timeout: 25_000, maxRetries: 0 });

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 6000,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: PLAN_SCHEMA as any },
    },
    system: buildSystemPrompt(context.courierCount, context.staffing),
    messages: [
      {
        role: 'user',
        content: [
          `Current local time: ${context.nowBerlin}`,
          `Restaurant: ${context.restaurantAddress}`,
          `Couriers on shift: ${context.courierCount}`,
          `Kitchen staff on shift: ${context.staffing.pizzaCooks} pizza cook(s), ${context.staffing.fryerHelpers} fryer helper(s), ${context.staffing.sushiChefs} sushi chef(s)`,
          '',
          `ACTIVE ORDERS (${context.orders.length}, oldest first):`,
          // id/hasPhone — служебные поля для панели, модели они не нужны.
          JSON.stringify(
            context.orders.map(({ id, hasPhone, ...rest }) => rest),
            null,
            2
          ),
          '',
          `ALREADY ON THE ROAD (courier busy): ${
            context.onTheRoad.length ? context.onTheRoad.join(', ') : 'none'
          }`,
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

  const raw = JSON.parse(textBlock.text);
  return normalizePlanVerdict(raw, context);
}

/**
 * Валидация ответа модели. Жёсткий инвариант: план покрывает все заказы
 * очереди ровно по одному разу — потерянные дописываем отдельным шагом в конец,
 * выдуманные/дубли выбрасываем.
 */
export function normalizePlanVerdict(raw: any, context: KitchenPlanContext): KitchenPlan {
  if (!raw || !Array.isArray(raw.batches)) throw new Error('Malformed plan verdict');

  const queueNumbers = new Set(context.orders.map((o) => o.orderNumber));
  const seen = new Set<string>();

  const batches: KitchenPlanBatch[] = [];
  for (const b of raw.batches) {
    const orderNumbers = (Array.isArray(b?.orderNumbers) ? b.orderNumbers : [])
      .map((n: unknown) => String(n))
      .filter((n: string) => queueNumbers.has(n) && !seen.has(n));
    orderNumbers.forEach((n: string) => seen.add(n));
    if (orderNumbers.length === 0) continue;

    batches.push({
      step: batches.length + 1,
      orderNumbers,
      area: typeof b.area === 'string' && b.area.trim() ? b.area.trim() : '—',
      cookTogether: Boolean(b.cookTogether) && orderNumbers.length > 1,
      courier: typeof b.courier === 'string' && b.courier.trim() ? b.courier.trim() : null,
      rationale: typeof b.rationale === 'string' ? b.rationale.trim() : '',
    });
  }

  // Заказы, которые модель потеряла — отдельными шагами в конец.
  for (const o of context.orders) {
    if (seen.has(o.orderNumber)) continue;
    batches.push({
      step: batches.length + 1,
      orderNumbers: [o.orderNumber],
      area: o.deliveryType === 'pickup' ? 'Abholung' : o.city || '—',
      cookTogether: false,
      courier: null,
      rationale: 'Добавлен автоматически: AI не включил заказ в план.',
    });
  }

  return {
    batches,
    lateOrders: computeLateOrders(context),
    summary: typeof raw.summary === 'string' && raw.summary.trim() ? raw.summary.trim() : '',
    advisory:
      typeof raw.advisory === 'string' && raw.advisory.trim() ? raw.advisory.trim() : null,
    loadLevel: (['normal', 'busy', 'peak'] as const).includes(raw.loadLevel)
      ? raw.loadLevel
      : 'normal',
    source: 'ai',
    model: 'claude-opus-5',
    queueSize: context.orders.length,
    onTheRoad: context.onTheRoad,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Точка входа для API (AI → эвристика)
// ---------------------------------------------------------------------------

/** План из готового контекста: AI, при сбое/пустой очереди — эвристика. */
export async function planFromContext(context: KitchenPlanContext): Promise<KitchenPlan> {
  if (context.orders.length === 0) {
    // Нечего планировать — не тратим вызов AI.
    return heuristicKitchenPlan(context);
  }
  try {
    return await analyzeKitchenPlanWithClaude(context);
  } catch (e) {
    console.error('[kitchen-plan] AI failed, falling back to heuristic:', (e as Error)?.message);
    return heuristicKitchenPlan(context);
  }
}

export async function buildKitchenPlan(): Promise<KitchenPlan> {
  return planFromContext(await buildKitchenPlanContext());
}
