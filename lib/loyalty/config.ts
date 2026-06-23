/**
 * Конфигурация бонусной программы.
 *
 * Правила вынесены в один объект, читаются с дефолтами и переопределяются
 * ключом `loyaltyRules` в таблице settings (см. lib/settings.ts) — менять
 * экономику можно без правки кода. MVP реализует percent+tier+expiry; поля
 * firstOrderBonus / birthday / weekendMultiplier / categoryMultipliers —
 * точки расширения (применяются, если заданы; по умолчанию выключены).
 *
 * Текущая модель (дефолты; реальные значения берутся из settings.loyaltyRules,
 * редактируются в админке /admin/loyalty):
 *  - 1 балл = 1 € скидки (pointValueEuro = 1);
 *  - начисление: 3% от оплаченной суммы (Bronze), 5% Silver, 7% Gold;
 *  - уровни: Silber с 15 заказов, Gold с 30;
 *  - списание: до 30% суммы следующего заказа, минимальная сумма заказа 10 €;
 *  - баллы начисляются после статуса completed; сгорают через 12 месяцев.
 */
import { getSetting } from '../settings';

export type LoyaltyTier = 'bronze' | 'silver' | 'gold';

export interface LoyaltyRules {
  /** Процент начисления по уровню (доля: 0.05 = 5%). */
  earnPercentByTier: Record<LoyaltyTier, number>;
  /** Пороги уровней по числу завершённых (completed) заказов. */
  tierThresholds: { silver: number; gold: number };
  /** Максимальная доля заказа, оплачиваемая баллами (0.30 = 30%). */
  redeemMaxShare: number;
  /** Минимальная сумма заказа (€), при которой можно списывать баллы. */
  minOrderToRedeem: number;
  /** Сколько € даёт 1 балл при списании (1 = 1 балл → 1 €). */
  pointValueEuro: number;
  /** Срок действия начисленных баллов, месяцев. */
  expiryMonths: number;
  // --- точки расширения (по умолчанию выключены) ---
  /** Разовый бонус (баллы) за первый завершённый заказ. */
  firstOrderBonus: number;
  /** Бонус (баллы) в день рождения. */
  birthdayBonusPoints: number;
  /** Множитель начисления в выходные (1 = выкл). */
  weekendMultiplier: number;
  /** Дни недели, считающиеся «выходными» (0=вс ... 6=сб). */
  weekendDays: number[];
  /** Множители начисления по категориям: categoryId → множитель. */
  categoryMultipliers: Record<string, number>;
}

export const DEFAULT_LOYALTY_RULES: LoyaltyRules = {
  earnPercentByTier: { bronze: 0.03, silver: 0.05, gold: 0.07 },
  tierThresholds: { silver: 15, gold: 30 },
  redeemMaxShare: 0.3,
  minOrderToRedeem: 10,
  pointValueEuro: 1,
  expiryMonths: 12,
  firstOrderBonus: 0,
  birthdayBonusPoints: 0,
  weekendMultiplier: 1,
  weekendDays: [0, 6],
  categoryMultipliers: {},
};

/** Глубокое (на 1 уровень) слияние сохранённых правил с дефолтами. */
export function mergeLoyaltyRules(partial?: Partial<LoyaltyRules> | null): LoyaltyRules {
  if (!partial || typeof partial !== 'object') return DEFAULT_LOYALTY_RULES;
  return {
    ...DEFAULT_LOYALTY_RULES,
    ...partial,
    earnPercentByTier: {
      ...DEFAULT_LOYALTY_RULES.earnPercentByTier,
      ...(partial.earnPercentByTier || {}),
    },
    tierThresholds: {
      ...DEFAULT_LOYALTY_RULES.tierThresholds,
      ...(partial.tierThresholds || {}),
    },
    categoryMultipliers: {
      ...(partial.categoryMultipliers || {}),
    },
    weekendDays: partial.weekendDays || DEFAULT_LOYALTY_RULES.weekendDays,
  };
}

/** Правила из settings (с дефолтами). */
export async function getLoyaltyRules(): Promise<LoyaltyRules> {
  const stored = await getSetting<Partial<LoyaltyRules>>('loyaltyRules');
  return mergeLoyaltyRules(stored);
}

/** Уровень лояльности по числу завершённых заказов. */
export function resolveTier(completedOrders: number, rules: LoyaltyRules): LoyaltyTier {
  if (completedOrders >= rules.tierThresholds.gold) return 'gold';
  if (completedOrders >= rules.tierThresholds.silver) return 'silver';
  return 'bronze';
}

/** Процент начисления для уровня. */
export function earnPercentFor(tier: LoyaltyTier, rules: LoyaltyRules): number {
  return rules.earnPercentByTier[tier] ?? rules.earnPercentByTier.bronze;
}

/** Округление баллов до 2 знаков (1 балл = 1 €, допускаем центовую точность). */
export function roundPoints(points: number): number {
  return Math.round((points + Number.EPSILON) * 100) / 100;
}

export interface EarnInput {
  /** Оплаченная деньгами сумма (уже без части, погашенной баллами). */
  eligibleAmount: number;
  tier: LoyaltyTier;
  rules: LoyaltyRules;
  /** Дата заказа (для выходного множителя). */
  date?: Date;
  /** Это первый завершённый заказ клиента? */
  isFirstOrder?: boolean;
}

/**
 * Чистый расчёт начисляемых баллов. Учитывает уровень, выходной множитель и
 * разовый бонус за первый заказ. Не начисляет на отрицательные/нулевые суммы.
 */
export function computeEarnedPoints({
  eligibleAmount,
  tier,
  rules,
  date = new Date(),
  isFirstOrder = false,
}: EarnInput): number {
  if (!(eligibleAmount > 0)) return isFirstOrder ? roundPoints(rules.firstOrderBonus) : 0;
  const percent = earnPercentFor(tier, rules);
  let points = eligibleAmount * percent;
  if (rules.weekendMultiplier !== 1 && rules.weekendDays.includes(date.getDay())) {
    points *= rules.weekendMultiplier;
  }
  if (isFirstOrder) points += rules.firstOrderBonus;
  return roundPoints(points);
}

/**
 * Максимально допустимое к списанию число баллов для заказа.
 * Учитывает баланс, cap (доля заказа) и минимальную сумму заказа.
 * orderAmount — сумма заказа ДО списания баллов.
 */
export function computeMaxRedeemablePoints(
  balance: number,
  orderAmount: number,
  rules: LoyaltyRules
): number {
  if (orderAmount < rules.minOrderToRedeem) return 0;
  const capEuro = orderAmount * rules.redeemMaxShare;
  const capPoints = capEuro / rules.pointValueEuro;
  return Math.max(0, Math.floor(Math.min(balance, capPoints) * 100) / 100);
}
