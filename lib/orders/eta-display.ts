/**
 * Время для гостя на странице подтверждения: пик сценария — «когда приедет
 * пицца». Раньше там стояло только «so schnell wie möglich».
 *
 * Приоритет: Wunschzeit гостя → время, которое поставила кухня (etaMinutes
 * от etaSetAt) → окно из настройки магазина от момента заказа.
 */

const CLOCK = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatClock(date: Date): string {
  return CLOCK.format(date);
}

export type OrderEta =
  | { kind: 'desired'; time: string }
  | { kind: 'kitchen'; time: string }
  | { kind: 'window'; from: string; to: string }
  | null;

export function resolveOrderEta(
  order: {
    desiredDeliveryTime?: string | null;
    etaMinutes?: number | null;
    etaSetAt?: string | Date | null;
    createdAt?: string | Date | null;
  },
  rangeMinutes: { from: number; to: number } | null
): OrderEta {
  const desired = String(order.desiredDeliveryTime ?? '').trim();
  if (/^\d{1,2}:\d{2}$/.test(desired)) return { kind: 'desired', time: desired.padStart(5, '0') };

  const etaMinutes = Number(order.etaMinutes);
  const etaSetAt = order.etaSetAt ? new Date(order.etaSetAt) : null;
  if (etaMinutes > 0 && etaSetAt && !Number.isNaN(etaSetAt.getTime())) {
    return { kind: 'kitchen', time: formatClock(new Date(etaSetAt.getTime() + etaMinutes * 60_000)) };
  }

  const createdAt = order.createdAt ? new Date(order.createdAt) : null;
  if (rangeMinutes && createdAt && !Number.isNaN(createdAt.getTime())) {
    const at = (min: number) => formatClock(new Date(createdAt.getTime() + min * 60_000));
    return { kind: 'window', from: at(rangeMinutes.from), to: at(rangeMinutes.to) };
  }
  return null;
}
