import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Подписанный токен доступа к заказу (per-order access token).
 *
 * Зачем: раньше «владение» заказом подтверждалось совпадением phoneNumber из
 * query-параметра. Номер телефона — низкоэнтропийный и часто известен атакующему
 * (таргет), а orderId светился в URL подтверждения. Это давало IDOR: зная номер
 * жертвы и перебирая/собирая orderId, можно было вытащить чужой адрес.
 *
 * Теперь доступ к чужому заказу без сессии возможен ТОЛЬКО по этому токену.
 * Токен — HMAC-SHA256(secret, orderId): его нельзя подделать, не зная серверного
 * секрета, и он не хранится в БД (stateless — работает и для легаси-заказов).
 * Значение отдаётся только тому, кто оформил заказ (в ответе POST /api/orders),
 * и больше нигде не публикуется (в публичных выборках orderId тоже скрыт).
 *
 * Долгоживущий по дизайну: страница подтверждения, отслеживание и скачивание
 * счёта должны работать часами/днями. Ротация секрета инвалидирует все токены
 * разом (аварийный отзыв).
 */
function getSecret(): string {
  const secret =
    process.env.ORDER_ACCESS_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    (process.env.NODE_ENV === 'production' ? undefined : 'pizza-delivery-secret');
  if (!secret) {
    // Фейлимся закрыто: без секрета токены выписывать/проверять нельзя.
    throw new Error('ORDER_ACCESS_SECRET/NEXTAUTH_SECRET не задан');
  }
  return secret;
}

/** Выписать токен доступа для заказа. */
export function signOrderAccessToken(orderId: string): string {
  return createHmac('sha256', getSecret()).update(String(orderId)).digest('hex');
}

/**
 * Проверить токен доступа к заказу в постоянном по времени сравнении.
 * Возвращает false при любом несовпадении/ошибке (fail-closed).
 */
export function verifyOrderAccessToken(orderId: string, token?: string | null): boolean {
  if (!token || typeof token !== 'string') return false;
  let expected: string;
  try {
    expected = signOrderAccessToken(orderId);
  } catch {
    return false;
  }
  const a = Buffer.from(token, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
