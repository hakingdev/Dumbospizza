/**
 * Возврат со страницы /pay/[orderId] в приложение Dumbo Slice. Отдельный модуль
 * без серверных зависимостей (app-pay.ts тянет crypto) — его импортирует клиент.
 */

/** Единственная цель редиректа: схема приложения. Из запроса не берётся никогда. */
export const APP_PAYMENT_RETURN_BASE = 'dumbospizza://payment';

export type AppPayResult = 'success' | 'cancel' | 'failed';

export function buildAppReturnUrl(orderId: string, result: AppPayResult): string {
  return `${APP_PAYMENT_RETURN_BASE}?order=${encodeURIComponent(orderId)}&result=${result}`;
}
