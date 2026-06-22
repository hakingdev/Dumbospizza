/**
 * Единый источник истины для проверки валидности купона (Coupon).
 * Используется и на сервере (`/api/coupons`, `/api/orders`), и косвенно на клиенте
 * через стабильные machine-readable `reason`, чтобы checkout не отклонял купон,
 * который UI принял, и наоборот.
 */

export type CouponInvalidReason =
  | 'not_found'
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'usage_limit'
  | 'min_order';

export interface CouponValidityResult {
  valid: boolean;
  reason?: CouponInvalidReason;
}

export interface CouponValidityInput {
  active?: boolean;
  validFrom?: Date | string | null;
  validTo?: Date | string | null;
  usageLimit?: number | null;
  usageCount?: number | null;
  minOrderAmount?: number | null;
}

const DEFAULT_TZ = 'Europe/Berlin';

/** Нормализация кода купона: единообразно на клиенте и сервере. */
export function normalizeCouponCode(code: string | null | undefined): string {
  return (code || '').trim().toUpperCase();
}

/** Смещение зоны (минуты, local - UTC) для конкретного момента — учитывает DST. */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = Number(p.value);
  // 'en-US' может вернуть hour=24 для полуночи — нормализуем.
  const hour = map.hour === 24 ? 0 : map.hour;
  const asUTC = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second);
  return (asUTC - date.getTime()) / 60000;
}

/** Купон задан как «date-only», если время = ровно полночь UTC (без явного времени). */
function isDateOnly(d: Date): boolean {
  return (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

/**
 * Конец действия купона. Если `validTo` задан как date-only (полночь UTC), купон
 * должен быть валиден до КОНЦА этого дня в timezone магазина (по умолчанию Berlin),
 * иначе он «истекает» в начале дня. Если время задано явно — используем как есть.
 */
export function resolveCouponValidTo(validTo: Date, timeZone: string = DEFAULT_TZ): Date {
  if (!isDateOnly(validTo)) return validTo;
  const y = validTo.getUTCFullYear();
  const m = validTo.getUTCMonth();
  const d = validTo.getUTCDate();
  // 23:59:59.999 локального дня Berlin → UTC (offset берём в полдень, чтобы не попасть на DST-переход).
  const noonUtc = new Date(Date.UTC(y, m, d, 12, 0, 0));
  const offset = tzOffsetMinutes(noonUtc, timeZone);
  return new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - offset * 60000);
}

/** Начало действия: date-only `validFrom` → начало дня Berlin. */
export function resolveCouponValidFrom(validFrom: Date, timeZone: string = DEFAULT_TZ): Date {
  if (!isDateOnly(validFrom)) return validFrom;
  const y = validFrom.getUTCFullYear();
  const m = validFrom.getUTCMonth();
  const d = validFrom.getUTCDate();
  const noonUtc = new Date(Date.UTC(y, m, d, 12, 0, 0));
  const offset = tzOffsetMinutes(noonUtc, timeZone);
  return new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - offset * 60000);
}

/**
 * Единая проверка валидности купона. Возвращает не boolean, а причину.
 * @param orderAmount — если передан, дополнительно проверяет minOrderAmount.
 */
export function isCouponCurrentlyValid(
  coupon: CouponValidityInput | null | undefined,
  now: Date = new Date(),
  orderAmount?: number,
  timeZone: string = DEFAULT_TZ
): CouponValidityResult {
  if (!coupon) return { valid: false, reason: 'not_found' };
  if (coupon.active === false) return { valid: false, reason: 'inactive' };

  if (coupon.validFrom != null) {
    const from = resolveCouponValidFrom(new Date(coupon.validFrom), timeZone);
    if (now < from) return { valid: false, reason: 'not_started' };
  }
  if (coupon.validTo != null) {
    const to = resolveCouponValidTo(new Date(coupon.validTo), timeZone);
    if (now > to) return { valid: false, reason: 'expired' };
  }

  if (coupon.usageLimit != null && (coupon.usageCount ?? 0) >= coupon.usageLimit) {
    return { valid: false, reason: 'usage_limit' };
  }
  if (
    orderAmount !== undefined &&
    coupon.minOrderAmount != null &&
    coupon.minOrderAmount > 0 &&
    orderAmount < coupon.minOrderAmount
  ) {
    return { valid: false, reason: 'min_order' };
  }

  return { valid: true };
}
