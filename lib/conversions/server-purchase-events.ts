import type { NextRequest } from 'next/server';
import type { IOrder, IOrderItem } from '../models/order.model';
import { sendMetaCapiPurchase } from './meta-capi-purchase';
import { sendTikTokCompletePayment } from './tiktok-events-purchase';

function clientIpUa(request: NextRequest): { ip?: string; ua?: string } {
  const xf = request.headers.get('x-forwarded-for');
  const ip = xf?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || undefined;
  const ua = request.headers.get('user-agent') || undefined;
  return { ip, ua };
}

/** URL страницы, с которой пришёл заказ: referer, если он наш, иначе /checkout. */
function purchaseSourceUrl(request: NextRequest): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.dumbospizza.de';
  const referer = request.headers.get('referer') || '';
  return referer.startsWith(site) ? referer : `${site}/checkout`;
}

function productIdString(p: IOrderItem['product']): string {
  return String(p ?? '');
}

/**
 * Серверные конверсии после успешного сохранения заказа (не блокирует ответ клиенту).
 */
export async function sendServerPurchaseConversionEvents(order: IOrder, request: NextRequest): Promise<void> {
  const { ip, ua } = clientIpUa(request);
  const currency = 'EUR';
  const contentIds = order.items.map((i) => productIdString(i.product));
  const metaContents = order.items.map((i) => ({
    id: productIdString(i.product),
    quantity: i.quantity,
    itemPrice: i.price,
  }));
  const tiktokContents = order.items.map((i) => ({
    contentId: productIdString(i.product),
    quantity: i.quantity,
    price: i.price,
  }));

  await Promise.all([
    sendMetaCapiPurchase({
      orderNumber: order.orderNumber,
      value: order.total,
      currency,
      email: order.email,
      phone: order.phoneNumber,
      contentIds,
      contents: metaContents,
      clientIp: ip,
      userAgent: ua,
      eventSourceUrl: purchaseSourceUrl(request),
      fbp: request.cookies.get('_fbp')?.value || null,
      fbc: request.cookies.get('_fbc')?.value || null,
    }),
    sendTikTokCompletePayment({
      orderNumber: order.orderNumber,
      value: order.total,
      currency,
      email: order.email,
      phone: order.phoneNumber,
      contents: tiktokContents,
      clientIp: ip,
      userAgent: ua,
    }),
  ]);
}
