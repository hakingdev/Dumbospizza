/**
 * Обещания по доставке на витрине (время, бесплатная доставка, минимум)
 * считаются из данных, а не пишутся в тексты: зашитые «Kostenlose Lieferung
 * ab 30 €» и «30–45 Minuten» разошлись с зонами и настройкой магазина, и
 * гость узнавал правду только в checkout.
 */

export interface DeliveryZoneFact {
  deliveryFee?: number | null;
  minOrderAmount?: number | null;
  maxDistance?: number | null;
  active?: boolean;
}

export interface DeliveryZoneSummary {
  /** Радиус бесплатной доставки (самая дальняя зона с fee 0), км. */
  freeUpToKm: number | null;
  /** Наименьший Mindestbestellwert среди активных зон. */
  minOrderFrom: number | null;
  /** Наименьшая платная Liefergebühr. */
  paidFeeFrom: number | null;
}

/** «30-70» / «30–70» / «45» из настройки deliveryTime → «30–70» (или null). */
export function formatDeliveryTimeRange(raw: unknown): string | null {
  const nums = String(raw ?? '').match(/\d+/g);
  if (!nums || nums.length === 0) return null;
  const [from, to] = nums.map(Number);
  if (!Number.isFinite(from) || from <= 0) return null;
  if (to == null || to <= from) return String(from);
  return `${from}–${to}`;
}

export function summarizeDeliveryZones(zones: DeliveryZoneFact[]): DeliveryZoneSummary {
  const active = (zones || []).filter((z) => z && z.active !== false);
  const free = active.filter((z) => !(Number(z.deliveryFee) > 0));
  const paid = active.map((z) => Number(z.deliveryFee)).filter((fee) => fee > 0);
  const mins = active.map((z) => Number(z.minOrderAmount)).filter((m) => m > 0);
  const freeKm = free.map((z) => Number(z.maxDistance)).filter((km) => km > 0);
  return {
    freeUpToKm: freeKm.length ? Math.max(...freeKm) : null,
    minOrderFrom: mins.length ? Math.min(...mins) : null,
    paidFeeFrom: paid.length ? Math.min(...paid) : null,
  };
}
