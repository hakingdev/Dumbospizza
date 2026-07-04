/**
 * WhatsApp order status notifications.
 * Modes (по приоритету): (1) Twilio API — если заданы TWILIO_* env; без Content SID шлёт
 * обычный текст (песочница/24h-окно), с Content SID — одобренный шаблон;
 * (2) WhatsApp Web worker — пишет в очередь, воркер опрашивает сайт (исходящее с ПК);
 * (3) Meta Cloud API templates.
 */

import { getSetting } from './settings';
import { connectToDatabase } from './models';
import { WhatsAppQueue } from './models/whatsapp-queue.model';
import { SITE_URL } from './site-url';

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
  const base = (baseUrl || SITE_URL).replace(/\/$/, '');
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

interface TwilioConfig {
  accountSid: string;
  /** Basic-auth пара: API Key (SK.../secret) или Account SID/Auth Token. */
  authUser: string;
  authPass: string;
  from: string;
}

function getTwilioConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const from = process.env.TWILIO_WHATSAPP_FROM?.trim();
  if (!accountSid || !from) return null;

  const apiKeySid = process.env.TWILIO_API_KEY_SID?.trim();
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();

  let authUser: string;
  let authPass: string;
  if (apiKeySid && apiKeySecret) {
    authUser = apiKeySid;
    authPass = apiKeySecret;
  } else if (authToken) {
    authUser = accountSid;
    authPass = authToken;
  } else {
    return null;
  }

  return {
    accountSid,
    authUser,
    authPass,
    from: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
  };
}

async function sendViaTwilio(
  config: TwilioConfig,
  input: {
    phone: string;
    defaultCountryCode: string;
    contentSid?: string;
    contentVariables?: Record<string, string>;
    fallbackText: string;
  }
): Promise<boolean> {
  const normalized = normalizePhoneE164(input.phone, input.defaultCountryCode);
  if (!normalized) {
    console.error('WhatsApp (Twilio): invalid or empty phone number', input.phone);
    return false;
  }

  const params = new URLSearchParams({
    To: `whatsapp:+${normalized}`,
    From: config.from,
  });
  if (input.contentSid) {
    params.set('ContentSid', input.contentSid);
    if (input.contentVariables) {
      params.set('ContentVariables', JSON.stringify(input.contentVariables));
    }
  } else {
    params.set('Body', input.fallbackText);
  }

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' + Buffer.from(`${config.authUser}:${config.authPass}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error('WhatsApp Twilio API error:', res.status, errText);
    return false;
  }
  return true;
}

export async function enqueueWhatsAppMessageOnce(input: {
  phone: string;
  text: string;
  orderId?: string;
}): Promise<boolean> {
  if (input.orderId) {
    const existing = await WhatsAppQueue.findOne({
      orderId: input.orderId,
      text: input.text,
      status: { $in: ['pending', 'sending', 'sent'] },
    });
    if (existing) {
      console.info(
        '[whatsapp] enqueue skipped — message already queued/sent for order',
        JSON.stringify({ orderId: input.orderId })
      );
      return false;
    }
  }

  await WhatsAppQueue.create({
    phone: input.phone,
    text: input.text,
    status: 'pending',
    orderId: input.orderId,
  });
  console.info('[whatsapp] enqueued message', JSON.stringify({ orderId: input.orderId }));
  return true;
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

    const twilio = getTwilioConfig();
    if (twilio) {
      return sendViaTwilio(twilio, {
        phone: order.phoneNumber,
        defaultCountryCode:
          (storeSettings?.whatsappDefaultCountryCode as string)?.trim() || DEFAULT_COUNTRY_CODE,
        contentSid: process.env.TWILIO_CONTENT_SID_ORDER_PLACED?.trim() || undefined,
        contentVariables: { '1': order.orderNumber },
        fallbackText: messageText,
      });
    }

    const useWebWorker =
      storeSettings?.whatsappUseWebWorker === true ||
      String(process.env.USE_WHATSAPP_WEB_JS || process.env.WHATSAPP_USE_WEB_WORKER || '').toLowerCase() === 'true';

    if (useWebWorker) {
      const workerSecret =
        (storeSettings?.whatsappWebWorkerSecret as string)?.trim() || process.env.WHATSAPP_WEB_WORKER_SECRET?.trim();
      if (!workerSecret) return false;

      await enqueueWhatsAppMessageOnce({
        phone: order.phoneNumber,
        text: messageText,
        orderId: order.orderNumber,
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

    const twilio = getTwilioConfig();
    if (twilio) {
      return sendViaTwilio(twilio, {
        phone: order.phoneNumber,
        defaultCountryCode:
          (storeSettings?.whatsappDefaultCountryCode as string)?.trim() || DEFAULT_COUNTRY_CODE,
        contentSid: process.env.TWILIO_CONTENT_SID_ORDER_STATUS?.trim() || undefined,
        contentVariables: { '1': order.orderNumber, '2': statusLabel },
        fallbackText: messageText,
      });
    }

    const useWebWorker =
      storeSettings?.whatsappUseWebWorker === true ||
      String(process.env.USE_WHATSAPP_WEB_JS || process.env.WHATSAPP_USE_WEB_WORKER || '').toLowerCase() === 'true';

    if (useWebWorker) {
      const workerSecret =
        (storeSettings?.whatsappWebWorkerSecret as string)?.trim() || process.env.WHATSAPP_WEB_WORKER_SECRET?.trim();
      if (!workerSecret) return false;

      await enqueueWhatsAppMessageOnce({
        phone: order.phoneNumber,
        text: messageText,
        orderId: order.orderNumber,
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
