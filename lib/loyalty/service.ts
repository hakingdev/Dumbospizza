/**
 * Сервис бонусной программы.
 *
 * Баланс — агрегат в loyalty_programs; журнал — строки в loyalty_transactions.
 * Списание/начисление меняют баланс атомарным SQL-апдейтом (guarded), журнал
 * пишется строкой → нет двойного списания. Начисление происходит ПОСЛЕ статуса
 * completed; отмена заказа реверсит начисление и возвращает списанные баллы.
 *
 * Все операции идемпотентны по (order, type), чтобы повторный вызов
 * (ретраи вебхуков/смены статуса) не дублировал баллы.
 */
import { and, eq, lt, asc, sql } from 'drizzle-orm';
import db from '../db/client';
import { loyaltyPrograms, loyaltyTransactions, orders, users } from '../db/schema';
import {
  getLoyaltyRules,
  resolveTier,
  computeEarnedPoints,
  computeMaxRedeemablePoints,
  roundPoints,
  type LoyaltyRules,
  type LoyaltyTier,
} from './config';

type Db = typeof db;

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

/** Найти userId по заказу (поле user или по номеру телефона). */
async function resolveUserId(order: any): Promise<string | null> {
  if (typeof order.user === 'string' && order.user) return order.user;
  if (order.user && typeof order.user === 'object' && order.user.id) return order.user.id;
  if (order.phoneNumber) {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phoneNumber, order.phoneNumber))
      .limit(1);
    if (rows[0]) return rows[0].id;
  }
  return null;
}

/** Гарантировать наличие записи loyalty_programs; вернуть её id и баланс. */
async function ensureProgram(
  executor: Db,
  userId: string,
  phoneNumber: string
): Promise<{ id: string; balance: number }> {
  const existing = await executor
    .select({ id: loyaltyPrograms.id, balance: loyaltyPrograms.balance })
    .from(loyaltyPrograms)
    .where(eq(loyaltyPrograms.user, userId))
    .limit(1);
  if (existing[0]) return existing[0];

  // onConflict (user или phone) — берём существующую (гонка двух заказов).
  const inserted = await executor
    .insert(loyaltyPrograms)
    .values({ user: userId, phoneNumber: phoneNumber || userId, balance: 0 })
    .onConflictDoNothing()
    .returning({ id: loyaltyPrograms.id, balance: loyaltyPrograms.balance });
  if (inserted[0]) return inserted[0];

  const again = await executor
    .select({ id: loyaltyPrograms.id, balance: loyaltyPrograms.balance })
    .from(loyaltyPrograms)
    .where(eq(loyaltyPrograms.user, userId))
    .limit(1);
  return again[0];
}

/** Число завершённых (completed) заказов клиента — для уровня. */
export async function countCompletedOrders(userId: string, phoneNumber?: string): Promise<number> {
  const conds = phoneNumber
    ? sql`(${orders.user} = ${userId} OR ${orders.phoneNumber} = ${phoneNumber})`
    : eq(orders.user, userId);
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.status, 'completed'), conds));
  return rows[0]?.c ?? 0;
}

/** Текущий уровень клиента. */
export async function getTier(
  userId: string,
  phoneNumber?: string,
  rules?: LoyaltyRules
): Promise<LoyaltyTier> {
  const r = rules || (await getLoyaltyRules());
  const completed = await countCompletedOrders(userId, phoneNumber);
  return resolveTier(completed, r);
}

async function hasTxn(executor: Db, orderId: string, type: string): Promise<boolean> {
  const rows = await executor
    .select({ id: loyaltyTransactions.id })
    .from(loyaltyTransactions)
    .where(and(eq(loyaltyTransactions.order, orderId), eq(loyaltyTransactions.type, type)))
    .limit(1);
  return rows.length > 0;
}

export interface EarnResult {
  earned: number;
  balanceAfter: number;
  tier: LoyaltyTier;
}

/**
 * Начислить баллы за завершённый заказ. Идемпотентно (по earn-строке заказа).
 * eligibleAmount = order.total (деньги, уже без части, погашенной баллами).
 */
export async function earnForCompletedOrder(order: any): Promise<EarnResult | null> {
  const orderId = String(order._id || order.id);
  const userId = await resolveUserId(order);
  if (!userId) return null;

  if (await hasTxn(db, orderId, 'earn')) return null; // уже начислено

  const rules = await getLoyaltyRules();
  // completedOrders включает текущий заказ (он уже completed на момент вызова).
  const completedOrders = await countCompletedOrders(userId, order.phoneNumber);
  const tier = resolveTier(completedOrders, rules);
  const isFirstOrder = completedOrders <= 1;

  const eligibleAmount = Number(order.total) || 0;
  const points = computeEarnedPoints({
    eligibleAmount,
    tier,
    rules,
    date: order.createdAt ? new Date(order.createdAt) : new Date(),
    isFirstOrder,
  });
  if (points <= 0) return { earned: 0, balanceAfter: 0, tier };

  const expiresAt = addMonths(new Date(), rules.expiryMonths);

  const balanceAfter = await db.transaction(async (tx) => {
    await ensureProgram(tx as unknown as Db, userId, order.phoneNumber);
    const updated = await tx
      .update(loyaltyPrograms)
      .set({
        balance: sql`${loyaltyPrograms.balance} + ${points}`,
        totalEarned: sql`${loyaltyPrograms.totalEarned} + ${points}`,
      })
      .where(eq(loyaltyPrograms.user, userId))
      .returning({ balance: loyaltyPrograms.balance });
    const bal = Number(updated[0]?.balance ?? points);
    await tx.insert(loyaltyTransactions).values({
      user: userId,
      order: orderId,
      type: 'earn',
      amount: points,
      delta: points,
      balanceAfter: bal,
      description: `Начислено за заказ ${order.orderNumber || orderId} (${tier})`,
      expiresAt,
      consumed: 0,
    });
    return bal;
  });

  // Записать в заказ фактически начисленные баллы (best-effort).
  try {
    await db.update(orders).set({ loyaltyPointsEarned: Math.round(points) }).where(eq(orders.id, orderId));
  } catch {
    /* не критично */
  }

  return { earned: points, balanceAfter, tier };
}

export interface RedeemResult {
  success: boolean;
  redeemed: number;
  balanceAfter: number;
  reason?: string;
}

/**
 * Списать баллы (при размещении заказа). Атомарный guarded-апдейт не даст
 * уйти балансу в минус → защита от двойного списания. orderAmount — сумма
 * заказа ДО списания (для проверки cap 30% и минимальной суммы).
 */
export async function redeemPoints(
  userId: string,
  points: number,
  orderId?: string,
  orderAmount?: number,
  phoneNumber?: string
): Promise<RedeemResult> {
  const pts = roundPoints(points);
  if (!(pts > 0)) return { success: false, redeemed: 0, balanceAfter: 0, reason: 'no_points' };

  // Идемпотентность: если по заказу уже есть redeem — не списываем повторно.
  if (orderId && (await hasTxn(db, orderId, 'redeem'))) {
    return { success: true, redeemed: pts, balanceAfter: 0, reason: 'already_redeemed' };
  }

  const rules = await getLoyaltyRules();
  if (typeof orderAmount === 'number') {
    const program = await db
      .select({ balance: loyaltyPrograms.balance })
      .from(loyaltyPrograms)
      .where(eq(loyaltyPrograms.user, userId))
      .limit(1);
    const balance = Number(program[0]?.balance ?? 0);
    const maxRedeemable = computeMaxRedeemablePoints(balance, orderAmount, rules);
    if (pts > maxRedeemable) {
      return { success: false, redeemed: 0, balanceAfter: balance, reason: 'exceeds_cap' };
    }
  }

  const result = await db.transaction(async (tx) => {
    // Гарантируем строку программы (как в earn/reverse/adjust) — иначе guarded
    // UPDATE по отсутствующей строке молча затронет 0 строк и спишет «вникуда».
    await ensureProgram(tx as unknown as Db, userId, phoneNumber || userId);
    const updated = await tx
      .update(loyaltyPrograms)
      .set({
        balance: sql`${loyaltyPrograms.balance} - ${pts}`,
        totalRedeemed: sql`${loyaltyPrograms.totalRedeemed} + ${pts}`,
      })
      .where(and(eq(loyaltyPrograms.user, userId), sql`${loyaltyPrograms.balance} >= ${pts}`))
      .returning({ balance: loyaltyPrograms.balance });

    if (!updated[0]) return null; // недостаточно баллов

    const bal = Number(updated[0].balance);
    await tx.insert(loyaltyTransactions).values({
      user: userId,
      order: orderId,
      type: 'redeem',
      amount: pts,
      delta: -pts,
      balanceAfter: bal,
      description: orderId ? `Списано на заказ ${orderId}` : 'Списание баллов',
      consumed: 0,
    });
    // FIFO-расход earn-батчей (для корректного сгорания).
    await consumeBatches(tx as unknown as Db, userId, pts);
    return bal;
  });

  if (result === null) {
    return { success: false, redeemed: 0, balanceAfter: 0, reason: 'insufficient_balance' };
  }
  return { success: true, redeemed: pts, balanceAfter: result };
}

/**
 * Списание баллов при размещении заказа (вызывается из finalizeOrderPlacement).
 * Cap (30%/min-order) уже проверен в POST /api/orders, здесь только исполнение.
 */
export async function redeemPointsForOrder(order: any): Promise<RedeemResult> {
  const used = Number(order.loyaltyPointsUsed) || 0;
  if (used <= 0) return { success: false, redeemed: 0, balanceAfter: 0, reason: 'no_points' };
  const userId = await resolveUserId(order);
  if (!userId) return { success: false, redeemed: 0, balanceAfter: 0, reason: 'no_user' };
  return redeemPoints(userId, used, String(order._id || order.id), undefined, order.phoneNumber);
}

/** Пометить earn-батчи израсходованными FIFO (oldest first). */
async function consumeBatches(executor: Db, userId: string, points: number): Promise<void> {
  let remaining = roundPoints(points);
  const batches = await executor
    .select({
      id: loyaltyTransactions.id,
      amount: loyaltyTransactions.amount,
      consumed: loyaltyTransactions.consumed,
    })
    .from(loyaltyTransactions)
    .where(and(eq(loyaltyTransactions.user, userId), eq(loyaltyTransactions.type, 'earn')))
    .orderBy(asc(loyaltyTransactions.createdAt));

  for (const b of batches) {
    if (remaining <= 0) break;
    const free = roundPoints(Number(b.amount) - Number(b.consumed));
    if (free <= 0) continue;
    const take = Math.min(free, remaining);
    await executor
      .update(loyaltyTransactions)
      .set({ consumed: sql`${loyaltyTransactions.consumed} + ${take}` })
      .where(eq(loyaltyTransactions.id, b.id));
    remaining = roundPoints(remaining - take);
  }
}

/**
 * Реверс заказа при отмене: отменяет начисление (если было) и возвращает
 * списанные баллы. Идемпотентно (по reverse-строке заказа).
 */
export async function reverseOrder(order: any): Promise<void> {
  const orderId = String(order._id || order.id);
  const userId = await resolveUserId(order);
  if (!userId) return;

  if (await hasTxn(db, orderId, 'reverse')) return; // уже отменено

  // Сколько начислено и сколько списано по этому заказу.
  const earnRows = await db
    .select({ amount: loyaltyTransactions.amount })
    .from(loyaltyTransactions)
    .where(and(eq(loyaltyTransactions.order, orderId), eq(loyaltyTransactions.type, 'earn')));
  const redeemRows = await db
    .select({ amount: loyaltyTransactions.amount })
    .from(loyaltyTransactions)
    .where(and(eq(loyaltyTransactions.order, orderId), eq(loyaltyTransactions.type, 'redeem')));

  const earned = roundPoints(earnRows.reduce((s, r) => s + Number(r.amount), 0));
  const redeemed = roundPoints(redeemRows.reduce((s, r) => s + Number(r.amount), 0));
  // Чистая дельта: вернуть списанное (+), отнять начисленное (−).
  const netDelta = roundPoints(redeemed - earned);
  if (earned === 0 && redeemed === 0) return;

  await db.transaction(async (tx) => {
    await ensureProgram(tx as unknown as Db, userId, order.phoneNumber);
    // Не уводим баланс в минус: вычитаем начисленное не более текущего баланса.
    const updated = await tx
      .update(loyaltyPrograms)
      .set({
        balance: sql`GREATEST(${loyaltyPrograms.balance} + ${netDelta}, 0)`,
      })
      .where(eq(loyaltyPrograms.user, userId))
      .returning({ balance: loyaltyPrograms.balance });
    const bal = Number(updated[0]?.balance ?? 0);
    await tx.insert(loyaltyTransactions).values({
      user: userId,
      order: orderId,
      type: 'reverse',
      amount: roundPoints(Math.abs(netDelta)),
      delta: netDelta,
      balanceAfter: bal,
      description: `Отмена заказа ${order.orderNumber || orderId}: возврат ${redeemed}, снятие ${earned}`,
      consumed: 0,
    });
  });
}

export interface AdjustResult {
  balanceAfter: number;
}

/** Ручная корректировка баллов администратором (delta может быть ±). */
export async function adjustPoints(
  userId: string,
  delta: number,
  description: string,
  phoneNumber?: string
): Promise<AdjustResult> {
  const d = roundPoints(delta);
  return db.transaction(async (tx) => {
    await ensureProgram(tx as unknown as Db, userId, phoneNumber || userId);
    const updated = await tx
      .update(loyaltyPrograms)
      .set({
        balance: sql`GREATEST(${loyaltyPrograms.balance} + ${d}, 0)`,
        totalEarned: d > 0 ? sql`${loyaltyPrograms.totalEarned} + ${d}` : sql`${loyaltyPrograms.totalEarned}`,
        totalRedeemed:
          d < 0 ? sql`${loyaltyPrograms.totalRedeemed} + ${-d}` : sql`${loyaltyPrograms.totalRedeemed}`,
      })
      .where(eq(loyaltyPrograms.user, userId))
      .returning({ balance: loyaltyPrograms.balance });
    const bal = Number(updated[0]?.balance ?? 0);
    await tx.insert(loyaltyTransactions).values({
      user: userId,
      type: 'adjust',
      amount: roundPoints(Math.abs(d)),
      delta: d,
      balanceAfter: bal,
      description: description || 'Ручная корректировка',
      ...(d > 0 ? { expiresAt: addMonths(new Date(), DEFAULT_EXPIRY_MONTHS) } : {}),
      consumed: 0,
    });
    return { balanceAfter: bal };
  });
}

const DEFAULT_EXPIRY_MONTHS = 12;

/**
 * Сгорание баллов: для каждого истёкшего earn-батча с остатком (amount−consumed)
 * списываем остаток с баланса и пишем строку 'expire'. Предназначено для cron.
 * Возвращает суммарно сгоревшие баллы.
 */
export async function expirePoints(now: Date = new Date()): Promise<number> {
  const expired = await db
    .select({
      id: loyaltyTransactions.id,
      user: loyaltyTransactions.user,
      amount: loyaltyTransactions.amount,
      consumed: loyaltyTransactions.consumed,
    })
    .from(loyaltyTransactions)
    .where(
      and(
        eq(loyaltyTransactions.type, 'earn'),
        lt(loyaltyTransactions.expiresAt, now),
        sql`${loyaltyTransactions.consumed} < ${loyaltyTransactions.amount}`
      )
    );

  let total = 0;
  for (const batch of expired) {
    const remaining = roundPoints(Number(batch.amount) - Number(batch.consumed));
    if (remaining <= 0) continue;
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(loyaltyPrograms)
        .set({ balance: sql`GREATEST(${loyaltyPrograms.balance} - ${remaining}, 0)` })
        .where(eq(loyaltyPrograms.user, batch.user))
        .returning({ balance: loyaltyPrograms.balance });
      const bal = Number(updated[0]?.balance ?? 0);
      await tx
        .update(loyaltyTransactions)
        .set({ consumed: batch.amount })
        .where(eq(loyaltyTransactions.id, batch.id));
      await tx.insert(loyaltyTransactions).values({
        user: batch.user,
        type: 'expire',
        amount: remaining,
        delta: -remaining,
        balanceAfter: bal,
        description: 'Сгорание баллов (срок действия истёк)',
        consumed: 0,
      });
    });
    total = roundPoints(total + remaining);
  }
  return total;
}

export interface LoyaltySummary {
  balance: number;
  totalEarned: number;
  totalRedeemed: number;
  tier: LoyaltyTier;
  completedOrders: number;
  nextTier: { tier: LoyaltyTier; ordersNeeded: number } | null;
}

/** Сводка для кабинета/админки. */
export async function getLoyaltySummary(
  userId: string,
  phoneNumber?: string
): Promise<LoyaltySummary> {
  const rules = await getLoyaltyRules();
  const program = await db
    .select({
      balance: loyaltyPrograms.balance,
      totalEarned: loyaltyPrograms.totalEarned,
      totalRedeemed: loyaltyPrograms.totalRedeemed,
    })
    .from(loyaltyPrograms)
    .where(eq(loyaltyPrograms.user, userId))
    .limit(1);
  const completedOrders = await countCompletedOrders(userId, phoneNumber);
  const tier = resolveTier(completedOrders, rules);

  let nextTier: LoyaltySummary['nextTier'] = null;
  if (tier === 'bronze') {
    nextTier = { tier: 'silver', ordersNeeded: Math.max(0, rules.tierThresholds.silver - completedOrders) };
  } else if (tier === 'silver') {
    nextTier = { tier: 'gold', ordersNeeded: Math.max(0, rules.tierThresholds.gold - completedOrders) };
  }

  return {
    balance: Number(program[0]?.balance ?? 0),
    totalEarned: Number(program[0]?.totalEarned ?? 0),
    totalRedeemed: Number(program[0]?.totalRedeemed ?? 0),
    tier,
    completedOrders,
    nextTier,
  };
}

/** Текущий баланс баллов пользователя (0, если программы нет). */
export async function getBalance(userId: string): Promise<number> {
  const rows = await db
    .select({ balance: loyaltyPrograms.balance })
    .from(loyaltyPrograms)
    .where(eq(loyaltyPrograms.user, userId))
    .limit(1);
  return Number(rows[0]?.balance ?? 0);
}

/** История операций (для кабинета/админки). */
export async function getTransactions(userId: string, limit = 50) {
  return db
    .select()
    .from(loyaltyTransactions)
    .where(eq(loyaltyTransactions.user, userId))
    .orderBy(sql`${loyaltyTransactions.createdAt} DESC`)
    .limit(limit);
}
