import { hashEmail, hashPhone } from './hash-pii';

export type MetaCapiPurchaseInput = {
  orderNumber: string;
  value: number;
  currency: string;
  email?: string | null;
  phone?: string | null;
  contentIds: string[];
  contents: { id: string; quantity: number; itemPrice: number }[];
  clientIp?: string | null;
  userAgent?: string | null;
};

/**
 * Meta Conversions API — Purchase.
 * event_id = orderNumber для дедупликации с клиентским App Event / Pixel.
 * @see https://developers.facebook.com/docs/marketing-api/conversions-api/parameters
 */
export async function sendMetaCapiPurchase(input: MetaCapiPurchaseInput): Promise<void> {
  const pixelId = process.env.META_PIXEL_ID?.trim();
  const token = process.env.META_CAPI_ACCESS_TOKEN?.trim();
  if (!pixelId || !token) return;

  const userData: Record<string, unknown> = {};
  if (input.email) userData.em = [hashEmail(input.email)];
  if (input.phone) {
    const ph = hashPhone(input.phone);
    if (ph) userData.ph = [ph];
  }
  if (input.clientIp) userData.client_ip_address = input.clientIp;
  if (input.userAgent) userData.client_user_agent = input.userAgent;

  const body: Record<string, unknown> = {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: input.orderNumber,
        action_source: 'app',
        user_data: userData,
        custom_data: {
          currency: input.currency,
          value: input.value,
          content_ids: input.contentIds,
          content_type: 'product',
          contents: input.contents.map((c) => ({
            id: c.id,
            quantity: c.quantity,
            item_price: c.itemPrice,
          })),
        },
      },
    ],
  };

  const testCode = process.env.META_CAPI_TEST_EVENT_CODE?.trim();
  if (testCode) body.test_event_code = testCode;

  const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error('[Meta CAPI] Purchase failed', res.status, text.slice(0, 500));
    return;
  }
  try {
    const j = JSON.parse(text) as { events_received?: number };
    if (j.events_received === 0) console.warn('[Meta CAPI] events_received=0', text.slice(0, 300));
  } catch {
    /* ok */
  }
}
