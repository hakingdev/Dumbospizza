import { verifyOrderAccessToken } from '../orders/access-token';
import {
  isOnlineCheckoutMethod,
  resolveVisibleGroups,
  type OnlineMethodId,
  type VisibleMethodGroup,
} from './method-groups';

/**
 * Страница оплаты для мобильного приложения Dumbo Slice: /pay/[orderId].
 *
 * Приложение создаёт draft-заказ (POST /api/orders, paymentMethod 'online'),
 * открывает эту страницу в ASWebAuthenticationSession
 * (expo-web-browser openAuthSessionAsync) и ждёт возврата на
 * `dumbospizza://payment?order=<id>&result=<success|cancel|failed>`.
 * Платёжной логики здесь нет: страница монтирует тот же OnlinePaymentPanel,
 * что и чекаут сайта, а оплату подтверждает сервер (SumUp confirm/webhook,
 * PayPal capture/webhook → claimOrderPaidAndPromote). Приложение после
 * возврата опрашивает GET /api/orders/:id?token — результат редиректа для
 * него только подсказка.
 */

/** = PENDING_PAYMENT_STATUS (lib/orders/payment-draft; тот тянет db-клиент — модуль держим чистым). */
const PENDING_PAYMENT_STATUS = 'pending_payment';

export { APP_PAYMENT_RETURN_BASE, buildAppReturnUrl, type AppPayResult } from './app-return';

/** ?method= страницы оплаты: только онлайн-группы (online | paypal | sepa). */
export function parseAppPayMethod(raw: unknown): OnlineMethodId | null {
  return typeof raw === 'string' && isOnlineCheckoutMethod(raw) ? raw : null;
}

export interface AppPayOrder {
  id: string;
  paymentMethod: string;
  paymentStatus: string;
  status: string;
}

export type AppPayAccess =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'not_online' | 'already_paid' | 'not_payable' };

/**
 * Можно ли платить за заказ на этой странице. Токен проверяется ВСЕГДА и
 * первым (до любых деталей заказа), как в PayPal-роутах (lib/paypal/ownership):
 * без валидного HMAC-токена заказа страница не раскрывает даже его статус.
 * Сессии здесь нет: у auth-сессии приложения свой cookie-jar.
 */
export function evaluateAppPayAccess(
  orderId: string,
  order: AppPayOrder | null,
  token: string | null | undefined
): AppPayAccess {
  if (!verifyOrderAccessToken(orderId, token)) return { ok: false, reason: 'forbidden' };
  if (!order || order.id !== orderId) return { ok: false, reason: 'not_found' };
  if (order.paymentMethod !== 'online') return { ok: false, reason: 'not_online' };
  if (order.paymentStatus === 'completed') return { ok: false, reason: 'already_paid' };
  if (order.status !== PENDING_PAYMENT_STATUS) return { ok: false, reason: 'not_payable' };
  return { ok: true };
}

/** Видимая группа выбранного метода (те же правила, что у чекаута сайта) или null. */
export function pickVisibleGroup(
  method: OnlineMethodId,
  available: string[] | null,
  paypalConfigured: boolean
): VisibleMethodGroup | null {
  return resolveVisibleGroups(available, { paypalConfigured }).find((g) => g.id === method) ?? null;
}

/** PayPal-кнопкам нужен публичный client id — тот же флаг, что у чекаута сайта. */
export function isPayPalConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID);
}
