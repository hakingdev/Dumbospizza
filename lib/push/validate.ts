/**
 * Валидация входа push-модуля и выбор аудитории — чистые функции (без БД).
 * Контракт с приложением: docs/push-notifications.md.
 */

import { isExpoPushToken, type PushData, type PushKind } from './expo';
import { normalizeGermanPhone } from '../sms/phone';

export type PushPlatform = 'ios' | 'android';
export type PushAudience = 'all' | 'ios' | 'android';

/** Жёсткие лимиты (сервер режет всё длиннее). */
export const PUSH_TITLE_MAX = 65;
export const PUSH_BODY_MAX = 240;
/** Рекомендация для UI: столько видно в свёрнутом уведомлении. */
export const PUSH_TITLE_SOFT = 40;
export const PUSH_BODY_SOFT = 120;

type Ok<T> = { ok: true; value: T; error?: undefined };
type Err = { ok: false; value?: undefined; error: string };
export type Result<T> = Ok<T> | Err;

export interface RegisterInput {
  token: string;
  platform: PushPlatform;
  phoneNumber: string | null;
  email: string | null;
  locale: string | null;
  appVersion: string | null;
  promoOptIn: boolean;
}

function optString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

export function parseRegisterBody(body: unknown): Result<RegisterInput> {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid JSON body' };
  const b = body as Record<string, unknown>;
  const token = typeof b.token === 'string' ? b.token.trim() : '';
  if (!isExpoPushToken(token)) return { ok: false, error: 'Invalid Expo push token' };
  if (b.platform !== 'ios' && b.platform !== 'android') {
    return { ok: false, error: 'platform must be "ios" or "android"' };
  }
  if (typeof b.promoOptIn !== 'boolean') return { ok: false, error: 'promoOptIn must be boolean' };

  const email = optString(b.email, 254)?.toLowerCase() ?? null;
  return {
    ok: true,
    value: {
      token,
      platform: b.platform,
      phoneNumber: b.phoneNumber == null ? null : normalizeGermanPhone(b.phoneNumber),
      email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
      locale: optString(b.locale, 16),
      appVersion: optString(b.appVersion, 32),
      promoOptIn: b.promoOptIn,
    },
  };
}

export function parseUnregisterBody(body: unknown): Result<{ token: string }> {
  const token = body && typeof body === 'object' ? (body as any).token : undefined;
  if (!isExpoPushToken(token)) return { ok: false, error: 'Invalid Expo push token' };
  return { ok: true, value: { token: token.trim() } };
}

/* ------------------------------------------------------------ deep links */

const ID_RE = '[A-Za-z0-9_-]{1,64}';
const DEEP_LINK_PATTERNS = [
  new RegExp(`^/product/${ID_RE}$`),
  /^\/menu\?category=[A-Za-z0-9%_\-.~]{1,120}$/,
  /^\/menu$/,
  /^\/cart$/,
  /^\/home$/,
  new RegExp(`^/order/${ID_RE}/tracking$`),
  /^\/account\/loyalty$/,
];

export function isAllowedDeepLink(url: string): boolean {
  return DEEP_LINK_PATTERNS.some((re) => re.test(url));
}

/* ------------------------------------------------------------ campaigns */

export interface CampaignInput {
  title: string;
  body: string;
  imageUrl: string | null;
  kind: Exclude<PushKind, 'order'>;
  url: string | null;
  promoCode: string | null;
  audience: PushAudience;
  /** null = отправить сейчас */
  scheduledAt: Date | null;
}

export function parseCampaignInput(body: unknown, now = new Date()): Result<CampaignInput> {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid JSON body' };
  const b = body as Record<string, unknown>;
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  const text = typeof b.body === 'string' ? b.body.trim() : '';
  if (!title) return { ok: false, error: 'Заголовок обязателен' };
  if (!text) return { ok: false, error: 'Текст обязателен' };
  if (title.length > PUSH_TITLE_MAX) return { ok: false, error: `Заголовок длиннее ${PUSH_TITLE_MAX} символов` };
  if (text.length > PUSH_BODY_MAX) return { ok: false, error: `Текст длиннее ${PUSH_BODY_MAX} символов` };

  const imageUrl = optString(b.imageUrl, 1000);
  if (imageUrl && !/^https:\/\/\S+$/i.test(imageUrl)) {
    return { ok: false, error: 'Картинка должна быть https-ссылкой' };
  }

  const kind = b.kind === undefined ? 'promo' : b.kind;
  if (kind !== 'promo' && kind !== 'info') return { ok: false, error: 'kind must be "promo" or "info"' };

  const url = optString(b.url, 200);
  if (url && !isAllowedDeepLink(url)) return { ok: false, error: 'Недопустимая ссылка в приложении' };

  const promoCode = optString(b.promoCode, 40)?.toUpperCase() ?? null;

  const audience = b.audience === undefined ? 'all' : b.audience;
  if (audience !== 'all' && audience !== 'ios' && audience !== 'android') {
    return { ok: false, error: 'audience must be all|ios|android' };
  }

  let scheduledAt: Date | null = null;
  if (b.scheduledAt != null && b.scheduledAt !== '') {
    const d = new Date(String(b.scheduledAt));
    if (Number.isNaN(d.getTime())) return { ok: false, error: 'Некорректная дата отправки' };
    if (d.getTime() < now.getTime() - 60_000) return { ok: false, error: 'Дата отправки в прошлом' };
    if (d.getTime() > now.getTime() + 60 * 86400_000) {
      return { ok: false, error: 'Запланировать можно не дальше чем на 60 дней' };
    }
    scheduledAt = d;
  }

  return {
    ok: true,
    value: { title, body: text, imageUrl, kind, url, promoCode, audience, scheduledAt },
  };
}

export function campaignData(input: Pick<CampaignInput, 'kind' | 'url' | 'promoCode'>, campaignId?: string): PushData {
  const data: PushData = { kind: input.kind };
  if (input.url) data.url = input.url;
  if (input.promoCode) data.promoCode = input.promoCode;
  if (campaignId) data.campaignId = campaignId;
  return data;
}

/* ------------------------------------------------------------ audience */

export interface AudienceDevice {
  token: string;
  platform: string;
  active: boolean;
  promoOptIn: boolean;
}

/**
 * Кому уходит рассылка. kind 'promo' — ТОЛЬКО устройства с promoOptIn
 * (реклама без согласия запрещена, § 7 UWG). 'info'/'order' — все активные.
 * Токены дедуплицируются, не-Expo токены (старые FCM/web) отбрасываются.
 */
export function selectAudienceTokens(
  devices: AudienceDevice[],
  opts: { kind: PushKind; audience: PushAudience }
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of devices) {
    if (!d.active) continue;
    if (opts.kind === 'promo' && !d.promoOptIn) continue;
    if (opts.audience !== 'all' && d.platform !== opts.audience) continue;
    if (!isExpoPushToken(d.token) || seen.has(d.token)) continue;
    seen.add(d.token);
    out.push(d.token);
  }
  return out;
}
