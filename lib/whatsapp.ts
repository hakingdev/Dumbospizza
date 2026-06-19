/**
 * WhatsApp order status notifications.
 * Two modes: (1) WhatsApp Web worker — пишет в очередь, воркер опрашивает сайт (исходящее с ПК);
 * (2) Meta Cloud API templates.
 */

import { getSetting } from './settings';
import { connectToDatabase } from './models';
import { WhatsAppQueue } from './models/whatsapp-queue.model';

const GRAPH_API_VERSION = 'v21.0';
const DEFAULT_COUNTRY_CODE = '49';

/** Короткие подписи для Meta Cloud API (шаблоны). */
const STATUS_LABELS: Record<string, string> = {
  new: 'Aufgegeben',
  preparing: 'Wird vorbereitet',
  ready_for_delivery: 'Fertig',
  delivering: 'Unterwegs',
  completed: 'Zugestellt',
  cancelled: 'Storniert'
};

/** Полные фразы для WhatsApp (режим воркера): статус заказа клиенту на немецком. {{orderNumber}} → номер заказа. */
const STATUS_MESSAGES_DE: Record<string, string> = {
  new: 'Ihre Bestellung {{orderNumber}} wurde aufgegeben.',
  preparing: 'Ihre Bestellung {{orderNumber}} wird vorbereitet.',
  ready_for_delivery: 'Ihre Bestellung {{orderNumber}} ist fertig.',
  delivering: 'Ihre Bestellung {{orderNumber}} ist unterwegs.',
  completed: 'Ihre Bestellung {{orderNumber}} wurde zugestellt.',
  cancelled: 'Ihre Bestellung {{orderNumber}} wurde storniert.'
};

function getTrackingUrl(orderNumber: string, baseUrl?: string): string {
  const base = (baseUrl || process.env.NEXTAUTH_URL || 'https://dumbospizza.de').replace(/\/$/, '');
  return `${base}/track?orderNumber=${encodeURIComponent(orderNumber)}`;
}

function normalizePhoneE164(phone: string, defaultCountryCode: string = DEFAULT_COUNTRY_CODE): string {
  const digits = phone.replace(/\D/g, '');
  if (!digits.length) return '';
  if (digits.startsWith('0')) {
    return defaultCountryCode + digits.slice(1);
  }
  if (digits.length <= 10 && !phone.includes('+')) {
    return defaultCountryCode + digits;
  }
  return digits;
}

export interface OrderForWhatsApp {
  phoneNumber: string;
  orderNumber: string;
}

/**
 * Send "order placed" message with thank-you text and tracking link (once, when order is created).
 * Fire-and-forget, never throws.
 */
export async function sendOrderPlacedNotification(order: OrderForWhatsApp): Promise<boolean> {
  try {
    await connectToDatabase();
    const storeSettings = await getSetting<Record<string, any>>('storeSettings', {});
    const enabled = storeSettings?.whatsappOrderNotificationsEnabled ?? false;
    if (!enabled) return false;

    const trackingUrl = getTrackingUrl(
      order.orderNumber,
      (storeSettings?.siteUrl as string)?.trim() || undefined
    );
    const messageText =
      `Vielen Dank für Ihre Bestellung!\n\n` +
      `Ihre Bestellung ${order.orderNumber} wurde erfolgreich aufgegeben. Wir liefern sie so schnell wie möglich.\n\n` +
      `Bestellung verfolgen: ${trackingUrl}`;

    const useWebWorker =
      storeSettings?.whatsappUseWebWorker === true ||
      String(process.env.USE_WHATSAPP_WEB_JS || process.env.WHATSAPP_USE_WEB_WORKER || '').toLowerCase() === 'true';

    if (useWebWorker) {
      const workerSecret =
        (storeSettings?.whatsappWebWorkerSecret as string)?.trim() || process.env.WHATSAPP_WEB_WORKER_SECRET?.trim();
      if (!workerSecret) return false;

      await WhatsAppQueue.create({
        phone: order.phoneNumber,
        text: messageText,
        status: 'pending',
        orderId: order.orderNumber
      });
      return true;
    }

    const phoneNumberId =
      storeSettings?.whatsappPhoneNumberId?.trim() || process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
    const accessToken =
      storeSettings?.whatsappAccessToken?.trim() || process.env.WHATSAPP_ACCESS_TOKEN?.trim();
    const defaultCountry =
      (storeSettings?.whatsappDefaultCountryCode as string)?.trim() || DEFAULT_COUNTRY_CODE;

    if (!phoneNumberId || !accessToken) return false;

    const normalizedPhone = normalizePhoneE164(order.phoneNumber, defaultCountry);
    if (!normalizedPhone) return false;

    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      to: normalizedPhone,
      type: 'text',
      text: { body: messageText }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('WhatsApp Cloud API (order placed):', res.status, errText);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error sending WhatsApp order placed notification:', error);
    return false;
  }
}

/**
 * Send order status update to customer via WhatsApp.
 * Mode: WhatsApp Web worker (if enabled) or Meta Cloud API. Fire-and-forget, never throws.
 */
export async function sendOrderStatusNotification(
  order: OrderForWhatsApp,
  newStatus: string
): Promise<boolean> {
  try {
    await connectToDatabase();
    const storeSettings = await getSetting<Record<string, any>>('storeSettings', {});
    const enabled = storeSettings?.whatsappOrderNotificationsEnabled ?? false;
    if (!enabled) return false;

    const statusLabel = STATUS_LABELS[newStatus] ?? newStatus;
    const statusMessageTemplate = STATUS_MESSAGES_DE[newStatus] ?? `Ihre Bestellung ${order.orderNumber}: ${newStatus}`;
    const messageText = statusMessageTemplate.replace(/\{\{orderNumber\}\}/g, order.orderNumber);

    const useWebWorker =
      storeSettings?.whatsappUseWebWorker === true ||
      String(process.env.USE_WHATSAPP_WEB_JS || process.env.WHATSAPP_USE_WEB_WORKER || '').toLowerCase() === 'true';

    if (useWebWorker) {
      const workerSecret =
        (storeSettings?.whatsappWebWorkerSecret as string)?.trim() || process.env.WHATSAPP_WEB_WORKER_SECRET?.trim();
      if (!workerSecret) return false;

      await WhatsAppQueue.create({
        phone: order.phoneNumber,
        text: messageText,
        status: 'pending',
        orderId: order.orderNumber
      });
      return true;
    }

    const phoneNumberId =
      storeSettings?.whatsappPhoneNumberId?.trim() || process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
    const accessToken =
      storeSettings?.whatsappAccessToken?.trim() || process.env.WHATSAPP_ACCESS_TOKEN?.trim();
    const defaultCountry =
      (storeSettings?.whatsappDefaultCountryCode as string)?.trim() || DEFAULT_COUNTRY_CODE;

    if (!phoneNumberId || !accessToken) return false;

    const normalizedPhone = normalizePhoneE164(order.phoneNumber, defaultCountry);
    if (!normalizedPhone) {
      console.error('WhatsApp: invalid or empty phone number', order.phoneNumber);
      return false;
    }

    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      to: normalizedPhone,
      type: 'template',
      template: {
        name: 'order_status_update',
        language: { code: 'de' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: order.orderNumber },
              { type: 'text', text: statusLabel }
            ]
          }
        ]
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('WhatsApp Cloud API error:', res.status, errText);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error sending WhatsApp order status notification:', error);
    return false;
  }
}
