import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import db from '../db/client';
import { orders, type Order as OrderRow } from '../db/schema';
import { generateNextOrderNumber } from './order-number';
import type { SumUpCheckout } from '../sumup';

/**
 * Драфты онлайн-оплаты («заказ появляется в „Заказы“ только после оплаты»).
 *
 * Жизненный цикл онлайн-заказа:
 *
 *   created(pending_payment) ──PAID──▶ promoted(new, номер, финализация)
 *          │
 *          ├─FAILED/EXPIRED──▶ payment_status='failed' (драфт остаётся невидимым)
 *          └─TTL (клиент ушёл)─▶ payment_status='failed' (cleanup)
 *
 * Инварианты:
 *  - Драфт (status='pending_payment') НЕ виден ни в одной выборке заказов
 *    (админ-список, экспорт, кабинет, принт-агент) — см. visibleOrderStatusFilter.
 *  - orderNumber драфту НЕ присваивается: нумерация — атрибут промоута
 *    (неудачные попытки не съедают номера и не создают дырок в кассовой ленте).
 *  - Промоут — ОДИН guarded UPDATE (CAS по payment_status): из N конкурентных
 *    вызовов (вебхук + confirm + PayPal capture) ровно один получает строку и
 *    запускает финализацию. Ключ идемпотентности — checkout_reference = orders.id
 *    (первичный ключ, уникальность из коробки).
 *  - 'failed' тоже промоутится: поздний PAID (вебхук после TTL-очистки, повторная
 *    оплата после отказа) обязан довести заказ до кухни — деньги уже списаны.
 *  - Оплата при получении (cash/card) не проходит через драфт: status='new'
 *    и финализация сразу при создании (см. initialOrderPlacementState).
 */

export const PENDING_PAYMENT_STATUS = 'pending_payment';

/** Стартовое состояние заказа по способу оплаты (используется POST /api/orders). */
export function initialOrderPlacementState(paymentMethod: string): {
  status: 'new' | 'pending_payment';
  /** true — финализировать (кухня/Telegram/печать) сразу при создании. */
  finalizeImmediately: boolean;
} {
  const awaitsPayment = paymentMethod === 'online';
  return {
    status: awaitsPayment ? PENDING_PAYMENT_STATUS : 'new',
    finalizeImmediately: !awaitsPayment,
  };
}

/**
 * Фильтр статуса для выборок заказов (Mongo-стиль, для mongoose-compat):
 * драфты не отдаются даже при явном запросе status=pending_payment — тогда
 * фильтр матчит заведомо несуществующий статус (пустая выборка).
 */
export function visibleOrderStatusFilter(requested?: string | null): string | { $ne: string } {
  if (!requested) return { $ne: PENDING_PAYMENT_STATUS };
  if (requested === PENDING_PAYMENT_STATUS) return '__hidden__';
  return requested;
}

// ---------------------------------------------------------------------------
// Store: минимальные примитивы с гарантиями атомарности (инъекция для тестов,
// паттерн lib/paypal/store.ts)
// ---------------------------------------------------------------------------

export interface PaymentDraftStore {
  getOrder(orderId: string): Promise<OrderRow | null>;
  /** Заказ по checkout_reference: сперва id (новая схема), затем orderNumber (легаси). */
  findOrderByCheckoutReference(reference: string): Promise<OrderRow | null>;
  /**
   * Guarded UPDATE промоута: payment_status IN (pending,failed) → completed,
   * pending_payment → new, order_number = COALESCE(order_number, кандидат).
   * Строка вернулась — именно этот вызов победил CAS; null — заказ не найден
   * или уже completed.
   */
  claimPaidAndPromote(orderId: string, orderNumberCandidate: string, now: Date): Promise<OrderRow | null>;
  /** CAS pending→failed. Оплаченный заказ не трогает. true — перевёл именно этот вызов. */
  markPaymentFailed(orderId: string): Promise<boolean>;
  nextOrderNumber(): Promise<string>;
  /** Пометить неоплаченные драфты старше cutoff как failed; вернуть затронутые. */
  markStaleDraftsFailed(cutoff: Date): Promise<Pick<OrderRow, 'id' | 'createdAt'>[]>;
}

/** Исполнитель drizzle (db или транзакция) — методы, которые использует стор. */
type DbExecutor = Pick<typeof db, 'select' | 'update'>;

const PROMOTED_STATUS_ENTRY = (now: Date) =>
  JSON.stringify([{ status: 'new', timestamp: now.toISOString() }]);

/**
 * Промоут на «голом» drizzle-исполнителе — используется и стором ниже, и
 * PayPal-стором (claimOrderPaid внутри транзакции вебхука).
 */
export async function claimPaidAndPromoteWithExecutor(
  dbx: DbExecutor,
  orderId: string,
  orderNumberCandidate: string,
  now = new Date()
): Promise<OrderRow | null> {
  const rows = await dbx
    .update(orders)
    .set({
      paymentStatus: 'completed',
      status: sql`CASE WHEN ${orders.status} = ${PENDING_PAYMENT_STATUS} THEN 'new' ELSE ${orders.status} END`,
      orderNumber: sql`COALESCE(${orders.orderNumber}, ${orderNumberCandidate})`,
      statusUpdates: sql`CASE WHEN ${orders.status} = ${PENDING_PAYMENT_STATUS}
        THEN ${orders.statusUpdates} || ${PROMOTED_STATUS_ENTRY(now)}::jsonb
        ELSE ${orders.statusUpdates} END`,
    })
    .where(and(eq(orders.id, orderId), inArray(orders.paymentStatus, ['pending', 'failed'])))
    .returning();
  return (rows[0] as OrderRow | undefined) ?? null;
}

class DrizzlePaymentDraftStore implements PaymentDraftStore {
  constructor(private readonly dbx: DbExecutor = db) {}

  async getOrder(orderId: string): Promise<OrderRow | null> {
    const rows = await this.dbx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    return (rows[0] as OrderRow | undefined) ?? null;
  }

  async findOrderByCheckoutReference(reference: string): Promise<OrderRow | null> {
    const byId = await this.getOrder(reference);
    if (byId) return byId;
    // Легаси: checkout'ы, созданные до перехода reference=orders.id, ссылались
    // на orderNumber (у заказов, размещённых до деплоя, номер уже есть).
    const rows = await this.dbx
      .select()
      .from(orders)
      .where(eq(orders.orderNumber, reference))
      .limit(1);
    return (rows[0] as OrderRow | undefined) ?? null;
  }

  claimPaidAndPromote(orderId: string, candidate: string, now: Date): Promise<OrderRow | null> {
    return claimPaidAndPromoteWithExecutor(this.dbx, orderId, candidate, now);
  }

  async markPaymentFailed(orderId: string): Promise<boolean> {
    const rows = await this.dbx
      .update(orders)
      .set({ paymentStatus: 'failed' })
      .where(and(eq(orders.id, orderId), eq(orders.paymentStatus, 'pending')))
      .returning({ id: orders.id });
    return rows.length > 0;
  }

  nextOrderNumber(): Promise<string> {
    return generateNextOrderNumber(this.dbx as Pick<typeof db, 'select'>);
  }

  async markStaleDraftsFailed(cutoff: Date): Promise<Pick<OrderRow, 'id' | 'createdAt'>[]> {
    return this.dbx
      .update(orders)
      .set({ paymentStatus: 'failed' })
      .where(
        and(
          eq(orders.status, PENDING_PAYMENT_STATUS),
          eq(orders.paymentStatus, 'pending'),
          lt(orders.createdAt, cutoff)
        )
      )
      .returning({ id: orders.id, createdAt: orders.createdAt });
  }
}

let defaultStore: PaymentDraftStore | null = null;

export function getPaymentDraftStore(): PaymentDraftStore {
  if (!defaultStore) defaultStore = new DrizzlePaymentDraftStore();
  return defaultStore;
}

/** Подмена стора в тестах (in-memory с теми же CAS-семантиками). */
export function setPaymentDraftStoreForTests(store: PaymentDraftStore | null): void {
  defaultStore = store;
}

// ---------------------------------------------------------------------------
// Промоут (оркестрация: генерация номера + ретрай на конфликт уникальности)
// ---------------------------------------------------------------------------

export interface ClaimPromoteOptions {
  store?: PaymentDraftStore;
  log?: (msg: string) => void;
  /** Попыток при конфликте orderNumber (гонка с параллельной нумерацией). */
  maxNumberAttempts?: number;
  now?: () => Date;
}

export interface ClaimPromoteResult {
  /** true — именно этот вызов перевёл заказ в оплаченные → финализировать. */
  claimed: boolean;
  /** Актуальная строка заказа (после промоута либо текущая). */
  order: OrderRow | null;
  /** CAS не прошёл, потому что заказ уже оплачен (дубль вебхука/confirm). */
  alreadyPaid: boolean;
}

/** Ошибка уникального индекса Postgres (23505) — на любом уровне обёртки. */
export function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

/**
 * Идемпотентный промоут оплаченного заказа/драфта. Все точки подтверждения
 * оплаты (SumUp confirm, SumUp webhook, PayPal capture/webhook) сходятся сюда:
 * ровно один вызов возвращает claimed=true.
 */
export async function claimOrderPaidAndPromote(
  orderId: string,
  options: ClaimPromoteOptions = {}
): Promise<ClaimPromoteResult> {
  const store = options.store ?? getPaymentDraftStore();
  const log = options.log ?? ((msg: string) => console.log(msg));
  const attempts = Math.max(1, options.maxNumberAttempts ?? 3);
  const now = options.now ?? (() => new Date());

  for (let attempt = 1; ; attempt++) {
    const candidate = await store.nextOrderNumber();
    try {
      const promoted = await store.claimPaidAndPromote(orderId, candidate, now());
      if (promoted) {
        log(
          `[payment-draft] paid_promoted order=${orderId} number=${promoted.orderNumber} status=${promoted.status}`
        );
        return { claimed: true, order: promoted, alreadyPaid: false };
      }
      const current = await store.getOrder(orderId);
      return {
        claimed: false,
        order: current,
        alreadyPaid: current?.paymentStatus === 'completed',
      };
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= attempts) throw error;
      log(
        `[payment-draft] number_conflict order=${orderId} candidate=${candidate} attempt=${attempt} — retry`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Обработка серверно-верифицированного статуса SumUp-checkout
// (общая для вебхука CHECKOUT_STATUS_CHANGED и confirm после редиректа/виджета)
// ---------------------------------------------------------------------------

/**
 * id checkout'а из известных форм тела вебхука SumUp (payload.checkout_id /
 * payload.id / checkout_id / id). Единственное, что берётся из тела: состояние
 * всегда перепроверяется серверным GET /v0.1/checkouts/{id}.
 */
export function extractSumUpCheckoutId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, any>;
  const candidates = [b.payload?.checkout_id, b.payload?.id, b.checkout_id, b.id];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return null;
}

export type SumUpStatusOutcome =
  | { outcome: 'promoted'; order: OrderRow }
  | { outcome: 'already_paid'; order: OrderRow }
  | { outcome: 'marked_failed'; order: OrderRow }
  | { outcome: 'pending'; order: OrderRow }
  | { outcome: 'order_not_found' }
  | { outcome: 'not_online'; order: OrderRow }
  | { outcome: 'amount_mismatch'; order: OrderRow };

export interface ApplySumUpStatusDeps {
  store?: PaymentDraftStore;
  log?: (msg: string) => void;
  logError?: (msg: string) => void;
  /**
   * Побочные эффекты промоута (Telegram/печать/лояльность) — вызывается ровно
   * для победителя CAS. Ошибка финализации НЕ отменяет оплату: ловится и
   * логируется здесь (паттерн PayPal capture/webhook).
   */
  finalize?: (order: OrderRow) => Promise<void>;
  now?: () => Date;
}

/** Допуск на округление суммы (евро ↔ центы), как в isSumUpCheckoutPaid. */
function amountMatchesOrder(checkoutAmount: number, orderTotal: number): boolean {
  return Math.abs(checkoutAmount - Math.round(orderTotal * 100) / 100) <= 0.01;
}

/**
 * Применяет ВЕРИФИЦИРОВАННОЕ состояние checkout (полученное СЕРВЕРНЫМ
 * GET /v0.1/checkouts/{id}, никогда — из тела вебхука или колбэка клиента):
 *
 *  - PAID → идемпотентный промоут драфта в «Новый» + финализация (один раз);
 *  - FAILED / EXPIRED → пометить драфт неуспешным, заказ НЕ создаётся;
 *  - PENDING → no-op (решение придёт следующим событием).
 */
export async function applySumUpCheckoutStatus(
  checkout: Pick<SumUpCheckout, 'id' | 'checkout_reference' | 'status' | 'amount'>,
  deps: ApplySumUpStatusDeps = {}
): Promise<SumUpStatusOutcome> {
  const store = deps.store ?? getPaymentDraftStore();
  const log = deps.log ?? ((msg: string) => console.log(msg));
  const logError = deps.logError ?? ((msg: string) => console.error(msg));
  const ctx = `checkout=${checkout.id} reference=${checkout.checkout_reference}`;

  const order = await store.findOrderByCheckoutReference(checkout.checkout_reference);
  if (!order) {
    log(`[payment-draft] order_not_found ${ctx}`);
    return { outcome: 'order_not_found' };
  }
  if (order.paymentMethod !== 'online') {
    log(`[payment-draft] not_online order=${order.id} ${ctx}`);
    return { outcome: 'not_online', order };
  }

  switch (checkout.status) {
    case 'PAID': {
      if (!amountMatchesOrder(checkout.amount, order.total)) {
        logError(
          `[payment-draft] amount_mismatch order=${order.id} ${ctx} ` +
            `checkout=${checkout.amount} order=${order.total} — заказ НЕ промоутится`
        );
        return { outcome: 'amount_mismatch', order };
      }
      const result = await claimOrderPaidAndPromote(order.id, {
        store,
        log,
        now: deps.now,
      });
      if (result.claimed && result.order) {
        if (deps.finalize) {
          try {
            await deps.finalize(result.order);
          } catch (error) {
            logError(
              `[payment-draft] finalize_failed order=${order.id} ${ctx}: ` +
                (error instanceof Error ? error.message : String(error))
            );
          }
        }
        return { outcome: 'promoted', order: result.order };
      }
      log(`[payment-draft] already_paid order=${order.id} ${ctx}`);
      return { outcome: 'already_paid', order: result.order ?? order };
    }
    case 'FAILED':
    case 'EXPIRED': {
      if (order.paymentStatus === 'completed') {
        // Поздний FAILED по уже оплаченному заказу — не даунгрейдим оплату.
        log(`[payment-draft] stale_${checkout.status.toLowerCase()} order=${order.id} ${ctx}`);
        return { outcome: 'already_paid', order };
      }
      const marked = await store.markPaymentFailed(order.id);
      log(
        `[payment-draft] payment_${checkout.status.toLowerCase()} order=${order.id} ${ctx} marked=${marked}`
      );
      return { outcome: 'marked_failed', order };
    }
    default:
      log(`[payment-draft] status_pending order=${order.id} ${ctx}`);
      return { outcome: 'pending', order };
  }
}

// ---------------------------------------------------------------------------
// TTL-очистка брошенных драфтов (отмена, закрытие окна, таймаут)
// ---------------------------------------------------------------------------

export const DRAFT_TTL_MINUTES = 45;

export interface CleanupOptions {
  store?: PaymentDraftStore;
  ttlMinutes?: number;
  log?: (msg: string) => void;
  now?: () => Date;
}

/**
 * Помечает неоплаченные драфты старше TTL как failed. Драфты и так невидимы —
 * очистка фиксирует терминальное состояние (created→pending→expired в логах)
 * и не даёт зависшим PENDING жить вечно. Поздний PAID-вебхук после очистки
 * всё равно промоутит заказ (CAS принимает failed): деньги списаны — заказ
 * обязан дойти до кухни.
 */
export async function cleanupStalePaymentDrafts(options: CleanupOptions = {}): Promise<number> {
  const store = options.store ?? getPaymentDraftStore();
  const log = options.log ?? ((msg: string) => console.log(msg));
  const ttl = options.ttlMinutes ?? DRAFT_TTL_MINUTES;
  const now = options.now ? options.now() : new Date();
  const cutoff = new Date(now.getTime() - ttl * 60_000);

  const stale = await store.markStaleDraftsFailed(cutoff);
  for (const draft of stale) {
    log(
      `[payment-draft] draft_expired order=${draft.id} createdAt=${draft.createdAt?.toISOString?.() ?? draft.createdAt} ttlMin=${ttl}`
    );
  }
  return stale.length;
}

let lastSweepAtMs = 0;

/**
 * Ленивая TTL-очистка «по пути» (вызывается из GET /api/orders, который
 * принт-агент опрашивает круглосуточно): не чаще одного раза в intervalMs на
 * инстанс, ошибки глотает. Страхует случай, когда cron
 * (/api/payments/cleanup-drafts) не настроен.
 */
export async function sweepStaleDraftsThrottled(intervalMs = 10 * 60_000): Promise<void> {
  if (Date.now() - lastSweepAtMs < intervalMs) return;
  lastSweepAtMs = Date.now();
  try {
    await cleanupStalePaymentDrafts();
  } catch (error) {
    console.error('[payment-draft] cleanup_failed:', error);
  }
}
