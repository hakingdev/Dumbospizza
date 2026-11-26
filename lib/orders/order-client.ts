/**
 * Откуда пришёл заказ: сайт или наше мобильное приложение (iOS/Android).
 *
 * Контракт с приложением — три заголовка в POST /api/orders:
 *
 *   X-Client:       dumbos-app
 *   X-App-Platform: ios | android
 *   X-App-Version:  1.4.2
 *
 * Без `X-Client: dumbos-app` заказ считается сайтом (так же ведут себя старые
 * версии приложения, пока не обновятся). Платформа принимается только из
 * белого списка, версия — только короткая строка из безопасных символов:
 * значения уходят в Telegram и в админку.
 *
 * Метке не нужно доверять как деньгам: она влияет лишь на подпись канала, а по
 * выручке/бонусам 'app' и 'website' одинаковы (lib/orders/order-source.ts).
 * Если когда-нибудь появятся акции «только в приложении», понадобится
 * подписанный запрос, а не заголовок.
 */
import { APP_SOURCE, WEBSITE_SOURCE } from './order-source';

export const APP_CLIENT_ID = 'dumbos-app';

export type AppPlatform = 'ios' | 'android';

export interface OrderClientInfo {
  platform?: AppPlatform;
  version?: string;
}

export interface OrderClient {
  source: typeof WEBSITE_SOURCE | typeof APP_SOURCE;
  clientInfo: OrderClientInfo | null;
}

interface HeaderSource {
  get(name: string): string | null;
}

const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$/;

function normalizePlatform(raw: string | null): AppPlatform | undefined {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === 'ios' || value === 'android' ? value : undefined;
}

function normalizeVersion(raw: string | null): string | undefined {
  const value = String(raw ?? '').trim();
  return VERSION_RE.test(value) ? value : undefined;
}

/** Канал заказа по заголовкам запроса. */
export function parseOrderClient(headers: HeaderSource): OrderClient {
  const client = String(headers.get('x-client') ?? '').trim().toLowerCase();
  if (client !== APP_CLIENT_ID) {
    return { source: WEBSITE_SOURCE, clientInfo: null };
  }
  const info: OrderClientInfo = {};
  const platform = normalizePlatform(headers.get('x-app-platform'));
  const version = normalizeVersion(headers.get('x-app-version'));
  if (platform) info.platform = platform;
  if (version) info.version = version;
  return { source: APP_SOURCE, clientInfo: Object.keys(info).length ? info : null };
}

const PLATFORM_LABELS: Record<AppPlatform, string> = { ios: 'iOS', android: 'Android' };

/**
 * Подпись канала для Telegram: «📲 App · iOS». Для сайта и Lieferando — пусто:
 * помечаем только заказы из приложения, чтобы не шуметь в каждой карточке.
 * 📲, а не 📱: 📱 в карточке уже означает телефон клиента.
 */
export function orderChannelBadge(order: {
  source?: string | null;
  clientInfo?: OrderClientInfo | null;
}): string {
  if (order.source !== APP_SOURCE) return '';
  const platform = order.clientInfo?.platform;
  const label = platform ? PLATFORM_LABELS[platform] : undefined;
  return label ? `📲 App · ${label}` : '📲 App';
}
