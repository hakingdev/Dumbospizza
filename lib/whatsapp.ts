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
/**
 * Подписи статуса для гостя. Именно эта строка подставляется в утверждённый
 * WhatsApp-шаблон Twilio как переменная {{2}} — гость видит её, а не текст из
 * STATUS_MESSAGES_DE (тот идёт только в режиме web-воркера).
 *
 * ready_for_delivery зависит от типа заказа: у доставки это «курьер повёз»
 * (карточка в Telegram в этот момент уезжает в тему «Доставка»), а у самовывоза
 * никакого «unterwegs» нет — гость сам придёт, ему нужно «можно забирать».
 */
const STATUS_LABELS: Record<string, string> = {
  new: 'Aufgegeben',
  preparing: 'Wird vorbereitet',
  ready_for_delivery: 'Unterwegs',
  delivering: 'Unterwegs',
  completed: 'Fertig',
  cancelled: 'Storniert'
};

const PICKUP_STATUS_LABELS: Record<string, string> = {
  ready_for_delivery: 'Abholbereit',
  delivering: 'Abholbereit',
  completed: 'Abgeholt',
};

/** Полные фразы для WhatsApp (режим воркера): статус заказа клиенту на немецком. {{orderNumber}} → номер заказа. */
const STATUS_MESSAGES_DE: Record<string, string> = {
  new: 'Ihre Bestellung {{orderNumber}} wurde aufgegeben.',
  preparing: 'Ihre Bestellung {{orderNumber}} wird vorbereitet.',
  ready_for_delivery: 'Ihre Bestellung {{orderNumber}} ist unterwegs.',
  delivering: 'Ihre Bestellung {{orderNumber}} ist unterwegs.',
  completed: 'Ihre Bestellung {{orderNumber}} ist fertig. Guten Appetit!',
  cancelled: 'Ihre Bestellung {{orderNumber}} wurde storniert.'
};

const PICKUP_STATUS_MESSAGES_DE: Record<string, string> = {
  ready_for_delivery: 'Ihre Bestellung {{orderNumber}} ist fertig und kann abgeholt werden.',
  delivering: 'Ihre Bestellung {{orderNumber}} ist fertig und kann abgeholt werden.',
  completed: 'Ihre Bestellung {{orderNumber}} wurde abgeholt. Guten Appetit!',
};

/**
 * Что увидит гость при смене статуса: подпись для шаблона Twilio ({{2}}) и
 * готовая фраза для режима воркера. Вынесено отдельной функцией, потому что
 * этот текст уходит живым людям — он должен быть покрыт тестом.
 */
export function resolveStatusTexts(
  status: string,
  deliveryType?: string,
  orderNumber = ''
): { label: string; message: string } {
  const isPickup = deliveryType === 'pickup';
  const label =
    (isPickup ? PICKUP_STATUS_LABELS[status] : undefined) ?? STATUS_LABELS[status] ?? status;
  const template =
    (isPickup ? PICKUP_STATUS_MESSAGES_DE[status] : undefined) ??
    STATUS_MESSAGES_DE[status] ??
    `Ihre Bestellung {{orderNumber}}: ${status}`;
  return { label, message: template.replace(/\{\{orderNumber\}\}/g, orderNumber) };
}

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
  /** 'pickup' — гость забирает сам: подписи статусов другие (см. STATUS_LABELS). */
  deliveryType?: 'delivery' | 'pickup' | string;
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
 * Send the estimated preparation time to the customer via WhatsApp.
 * Вызывается кнопкой «⏱ Время готовности» в Telegram (lib/telegram.ts).
 *
 * Только Twilio: воркер whatsapp-web.js мёртв (номер забанен), а у Meta Cloud
 * API нет одобренного шаблона под это сообщение. Fire-and-forget, never throws.
 */
export async function sendOrderEtaNotification(
  order: OrderForWhatsApp,
  minutes: number
): Promise<boolean> {
  try {
    await connectToDatabase();
    const storeSettings = await getSetting<Record<string, any>>('storeSettings', {});
    const enabled = storeSettings?.whatsappOrderNotificationsEnabled ?? false;
    if (!enabled) return false;

    const twilio = getTwilioConfig();
    if (!twilio) {
      console.error('WhatsApp ETA: Twilio не настроен (TWILIO_ACCOUNT_SID/TWILIO_WHATSAPP_FROM)');
      return false;
    }

    // Без одобренного шаблона Meta не доставит сообщение вне 24h-окна — в проде
    // ContentSid обязателен, plain text остаётся только для песочницы.
    const contentSid = process.env.TWILIO_CONTENT_SID_ORDER_ETA?.trim() || undefined;
    if (!contentSid) {
      console.warn('WhatsApp ETA: TWILIO_CONTENT_SID_ORDER_ETA не задан — уйдёт plain text (только песочница/24h-окно)');
    }

    return sendViaTwilio(twilio, {
      phone: order.phoneNumber,
      defaultCountryCode:
        (storeSettings?.whatsappDefaultCountryCode as string)?.trim() || DEFAULT_COUNTRY_CODE,
      contentSid,
      contentVariables: { '1': order.orderNumber, '2': String(minutes) },
      // Дословно как в шаблоне bestellung_in_zubereitung — чтобы песочница и
      // прод не расходились текстом.
      fallbackText:
        `Ihre Bestellung ${order.orderNumber} wird zubereitet. ` +
        `Voraussichtlich fertig in ca. ${minutes} Minuten. Ihr Dumbo Pizza Team`,
    });
  } catch (error) {
    console.error('Error sending WhatsApp ETA notification:', error);
    return false;
  }
}

/**
 * «Заказ опаздывает на ~N минут» — кнопка в панели AI-плана кухни и в
 * Telegram-боте-диспетчере (POST /api/orders/[id]/delay → lib/orders/delay.ts).
 *
 * Только Twilio (как и ETA: воркер мёртв, у Meta нет шаблона). Без одобренного
 * шаблона TWILIO_CONTENT_SID_ORDER_DELAY текст дойдёт только в песочнице/24h-окне.
 * Fire-and-forget, never throws.
 */
export async function sendOrderDelayNotification(
  order: OrderForWhatsApp,
  delayMinutes: number
): Promise<boolean> {
  try {
    await connectToDatabase();
    const storeSettings = await getSetting<Record<string, any>>('storeSettings', {});
    const enabled = storeSettings?.whatsappOrderNotificationsEnabled ?? false;
    if (!enabled) return false;

    const twilio = getTwilioConfig();
    if (!twilio) {
      console.error('WhatsApp delay: Twilio не настроен (TWILIO_ACCOUNT_SID/TWILIO_WHATSAPP_FROM)');
      return false;
    }

    const contentSid = process.env.TWILIO_CONTENT_SID_ORDER_DELAY?.trim() || undefined;
    if (!contentSid) {
      console.warn(
        'WhatsApp delay: TWILIO_CONTENT_SID_ORDER_DELAY не задан — уйдёт plain text (только песочница/24h-окно)'
      );
    }

    return sendViaTwilio(twilio, {
      phone: order.phoneNumber,
      defaultCountryCode:
        (storeSettings?.whatsappDefaultCountryCode as string)?.trim() || DEFAULT_COUNTRY_CODE,
      contentSid,
      contentVariables: { '1': order.orderNumber, '2': String(delayMinutes) },
      // Дословно как в шаблоне bestellung_verspaetet — чтобы песочница и прод
      // не расходились текстом.
      fallbackText:
        `Leider verzögert sich Ihre Bestellung ${order.orderNumber} um ca. ${delayMinutes} Minuten. ` +
        `Wir bitten um Ihr Verständnis. Ihr Dumbo Pizza Team`,
    });
  } catch (error) {
    console.error('Error sending WhatsApp delay notification:', error);
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

    const { label: statusLabel, message: messageText } = resolveStatusTexts(
      newStatus,
      order.deliveryType,
      order.orderNumber
    );

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
