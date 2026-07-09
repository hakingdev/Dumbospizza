/**
 * Структурные логи PayPal-интеграции. Метрик-инфраструктуры в проекте нет —
 * события-счётчики (`create_order`, `capture_success`, `capture_fail`,
 * `webhook_verify_fail`, `amount_mismatch`, …) пишутся в лог-дрейн Vercel в
 * распознаваемом формате; алерты вешаются на подстроки `[PAYPAL][CRITICAL]`
 * и `[SECURITY]` (см. lib/security/rate-limit.ts logSecurityEvent).
 *
 * В data НИКОГДА не передавать секреты, access token или полные данные
 * плательщика — только идентификаторы (order_id, paypal_order_id, capture_id,
 * event_id) и суммы.
 */

function serialize(data: Record<string, unknown>): string {
  try {
    return JSON.stringify(data);
  } catch {
    return '{}';
  }
}

export function logPayPal(event: string, data: Record<string, unknown> = {}): void {
  console.log(`[PAYPAL] ${event} ${serialize(data)}`);
}

export function logPayPalError(event: string, data: Record<string, unknown> = {}): void {
  console.error(`[PAYPAL][ERROR] ${event} ${serialize(data)}`);
}

/** Критический уровень — на эти строки должен стоять алерт (amount_mismatch, reversed). */
export function logPayPalCritical(event: string, data: Record<string, unknown> = {}): void {
  console.error(`[PAYPAL][CRITICAL] ${event} ${serialize(data)}`);
}
