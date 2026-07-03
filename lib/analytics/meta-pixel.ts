/**
 * Клиентские события Meta Pixel (fbq). Базовый код пикселя грузится в app/layout.tsx.
 * eventId — для дедупликации с серверным Conversions API
 * (см. lib/conversions/meta-capi-purchase.ts: event_id = orderNumber).
 */
export type MetaPixelEvent = 'ViewContent' | 'AddToCart' | 'InitiateCheckout' | 'Purchase' | 'Lead';

export function trackMetaEvent(
  event: MetaPixelEvent,
  params?: Record<string, unknown>,
  eventId?: string
): void {
  if (typeof window === 'undefined' || !window.fbq) return;
  if (eventId) {
    window.fbq('track', event, params ?? {}, { eventID: eventId });
  } else {
    window.fbq('track', event, params ?? {});
  }
}
