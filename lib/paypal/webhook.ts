import { randomUUID } from 'crypto';
import { getPayPalConfig } from './config';
import { paypalPost } from './client';

/**
 * Верификация подписи вебхука PayPal через
 * POST /v1/notifications/verify-webhook-signature (ТЗ §6.3).
 *
 * Два железных правила:
 *  1. cert_url обязан лежать на https://*.paypal.com — проверяется ДО любого
 *     вызова API (заголовкам верить нельзя, пока подпись не подтверждена).
 *  2. Сырое тело события уходит в verify-запрос БАЙТ-В-БАЙТ как получено:
 *     JSON.parse → JSON.stringify может изменить порядок ключей/экранирование
 *     и сломать проверку подписи. Поэтому тело собирается конкатенацией строк.
 */

export interface PayPalWebhookHeaders {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
}

/** Достаёт заголовки передачи PayPal; null — если какого-то не хватает. */
export function extractWebhookHeaders(headers: Headers): PayPalWebhookHeaders | null {
  const authAlgo = headers.get('paypal-auth-algo');
  const certUrl = headers.get('paypal-cert-url');
  const transmissionId = headers.get('paypal-transmission-id');
  const transmissionSig = headers.get('paypal-transmission-sig');
  const transmissionTime = headers.get('paypal-transmission-time');
  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
    return null;
  }
  return { authAlgo, certUrl, transmissionId, transmissionSig, transmissionTime };
}

/** cert_url только с https://*.paypal.com — иначе отказ до вызова verify-API. */
export function isTrustedCertUrl(certUrl: string): boolean {
  try {
    const url = new URL(certUrl);
    if (url.protocol !== 'https:') return false;
    return url.hostname === 'paypal.com' || url.hostname.endsWith('.paypal.com');
  } catch {
    return false;
  }
}

/**
 * true — подпись подтверждена (verification_status === "SUCCESS").
 * Любой другой ответ/ошибка формата → false (fail-closed).
 */
export async function verifyWebhookSignature(
  headers: PayPalWebhookHeaders,
  rawBody: string
): Promise<boolean> {
  const cfg = getPayPalConfig();

  // webhook_event вставляется сырой строкой — см. комментарий модуля.
  const payload =
    '{' +
    `"auth_algo":${JSON.stringify(headers.authAlgo)},` +
    `"cert_url":${JSON.stringify(headers.certUrl)},` +
    `"transmission_id":${JSON.stringify(headers.transmissionId)},` +
    `"transmission_sig":${JSON.stringify(headers.transmissionSig)},` +
    `"transmission_time":${JSON.stringify(headers.transmissionTime)},` +
    `"webhook_id":${JSON.stringify(cfg.webhookId)},` +
    `"webhook_event":${rawBody}` +
    '}';

  const res = await paypalPost<{ verification_status?: string }>(
    '/v1/notifications/verify-webhook-signature',
    payload,
    randomUUID()
  );
  return res.data?.verification_status === 'SUCCESS';
}
