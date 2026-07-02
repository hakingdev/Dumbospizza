import type { PromotionLifecycle } from './types';
import type { HappyHourScheduleFields } from './schedule';
import {
  isOnScheduledWeekday,
  isWithinHappyHourTimeWindow,
} from './schedule';

export interface PromotionScheduleFields {
  enabled: boolean;
  validFrom: Date;
  validTo: Date;
}

export interface PromotionEffectivenessFields extends PromotionScheduleFields, HappyHourScheduleFields {}

export function getPromotionLifecycle(
  promo: PromotionScheduleFields,
  now: Date = new Date()
): PromotionLifecycle {
  if (!promo.enabled) return 'expired';
  if (now < promo.validFrom) return 'scheduled';
  if (now > promo.validTo) return 'expired';
  return 'active';
}

export function isPromotionActive(
  promo: PromotionScheduleFields,
  now: Date = new Date()
): boolean {
  return getPromotionLifecycle(promo, now) === 'active';
}

/** Скидка: дата кампании + выбранные дни недели + (опционально) Happy Hour по времени. */
export function isPromotionEffectivelyActive(
  promo: PromotionEffectivenessFields,
  now: Date = new Date()
): boolean {
  if (!isPromotionActive(promo, now)) return false;
  if (!isOnScheduledWeekday(promo, now)) return false;
  if (!isWithinHappyHourTimeWindow(promo, now)) return false;
  return true;
}

export function slugifyPromotionName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[äÄ]/g, 'ae')
    .replace(/[öÖ]/g, 'oe')
    .replace(/[üÜ]/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function defaultBadgeForType(
  type: string,
  opts: { percentValue?: number; fixedValue?: number; bogoMode?: string }
): string {
  switch (type) {
    case 'percent_discount':
      return opts.percentValue != null ? `-${Math.round(opts.percentValue)} %` : '-%';
    case 'fixed_discount':
      return opts.fixedValue != null ? `-${opts.fixedValue.toFixed(0)} €` : '-€';
    case 'bogo':
      return opts.bogoMode === 'half_price' ? '3. 50 %' : '2+1';
    case 'gratis_article':
      return 'GRATIS';
    default:
      return 'TOP DEAL';
  }
}
