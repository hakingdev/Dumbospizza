import { hashEmail, hashPhone } from './hash-pii';

export type TikTokPurchaseInput = {
  orderNumber: string;
  value: number;
  currency: string;
  email?: string | null;
  phone?: string | null;
  contents: { contentId: string; quantity: number; price: number }[];
  clientIp?: string | null;
  userAgent?: string | null;
};

/**
 * TikTok Events API (server) — CompletePayment.
 * event_id = orderNumber для дедупликации с SDK / Pixel.
 * @see https://ads.tiktok.com/marketing_api/docs
 */
export async function sendTikTokCompletePayment(input: TikTokPurchaseInput): Promise<void> {
  const pixelCode = process.env.TIKTOK_PIXEL_CODE?.trim();
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN?.trim();
  if (!pixelCode || !accessToken) return;

  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').slice(0, 19);

  const user: Record<string, string> = {};
  if (input.email) user.email = hashEmail(input.email);
  if (input.phone) {
    const ph = hashPhone(input.phone);
    if (ph) user.phone = ph;
  }
  if (input.clientIp) user.ip = input.clientIp;
  if (input.userAgent) user.user_agent = input.userAgent;

  const body = {
    event_source: 'web',
    event_source_id: pixelCode,
    data: [
      {
        event: 'CompletePayment',
        event_id: input.orderNumber,
        timestamp,
        properties: {
          currency: input.currency,
          value: input.value,
          content_type: 'product',
          contents: input.contents.map((c) => ({
            content_id: c.contentId,
            quantity: c.quantity,
            price: c.price,
          })),
        },
        ...(Object.keys(user).length > 0 ? { user } : {}),
      },
    ],
  };

  const res = await fetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
    method: 'POST',
    headers: {
      'Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error('[TikTok Events API] CompletePayment failed', res.status, text.slice(0, 500));
    return;
  }
  try {
    const j = JSON.parse(text) as { code?: number; message?: string };
    if (j.code !== undefined && j.code !== 0) {
      console.warn('[TikTok Events API] non-zero code', j.code, j.message, text.slice(0, 300));
    }
  } catch {
    /* ok */
  }
}
