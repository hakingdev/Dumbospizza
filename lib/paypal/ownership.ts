import type { NextRequest } from 'next/server';
import { verifyOrderAccessToken } from '../orders/access-token';
import { getCustomerSession } from '../customer-auth';

/**
 * Владение заказом для платёжных эндпоинтов PayPal (ТЗ §8): доступ есть либо
 * у гостя с HMAC-токеном заказа (выдаётся один раз в ответе POST /api/orders,
 * клиент шлёт его в заголовке x-order-access-token), либо у авторизованного
 * клиента, на которого заказ оформлен. Fail-closed.
 */
export const ORDER_ACCESS_HEADER = 'x-order-access-token';

export function canAccessOrder(
  request: NextRequest,
  order: { id: string; user: string | null }
): boolean {
  const token = request.headers.get(ORDER_ACCESS_HEADER);
  if (verifyOrderAccessToken(order.id, token)) return true;

  const session = getCustomerSession(request);
  if (session && order.user && session.userId === String(order.user)) return true;

  return false;
}
