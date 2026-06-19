import { Order } from '../models/order.model';
import { LoyaltyProgram } from '../models/loyalty.model';
import type { PromotionAudience, PromotionChannel } from './types';

export interface PromotionCustomerContext {
  isNewCustomer: boolean;
  isReturning: boolean;
  isVip: boolean;
}

const DEFAULT_VIP_LOYALTY_POINTS = 500;

function vipThreshold(): number {
  const raw = process.env.PROMO_VIP_LOYALTY_POINTS;
  const n = raw ? parseInt(raw, 10) : DEFAULT_VIP_LOYALTY_POINTS;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_VIP_LOYALTY_POINTS;
}

/** Определяет сегмент клиента по телефону (история заказов + loyalty). */
export async function resolvePromotionCustomerContext(
  phoneNumber?: string
): Promise<PromotionCustomerContext | undefined> {
  const phone = phoneNumber?.trim();
  if (!phone) return undefined;

  const [orderCount, loyalty] = await Promise.all([
    Order.countDocuments({
      phoneNumber: phone,
      status: { $nin: ['cancelled'] },
    }),
    LoyaltyProgram.findOne({ phoneNumber: phone }).lean(),
  ]);

  const loyaltyDoc = loyalty as { balance?: number; totalEarned?: number } | null;
  const threshold = vipThreshold();
  const balance = loyaltyDoc?.balance ?? 0;
  const totalEarned = loyaltyDoc?.totalEarned ?? 0;
  const isVip = balance >= threshold || totalEarned >= threshold * 2;

  return {
    isNewCustomer: orderCount === 0,
    isReturning: orderCount > 0,
    isVip,
  };
}

type PromoAudienceFields = { audience?: PromotionAudience | string };

/** Проверка сегмента аудитории акции. Без контекста клиента — только all / app_only / web_only. */
export function matchesAudience(
  promo: PromoAudienceFields,
  channel: PromotionChannel,
  context?: PromotionCustomerContext
): boolean {
  const audience = (promo.audience || 'all') as PromotionAudience;

  if (audience === 'all') return true;
  if (audience === 'app_only') return channel === 'app';
  if (audience === 'web_only') return channel === 'web';

  if (!context) return false;

  switch (audience) {
    case 'new_customers':
      return context.isNewCustomer;
    case 'returning':
      return context.isReturning;
    case 'vip':
      return context.isVip;
    default:
      return true;
  }
}
