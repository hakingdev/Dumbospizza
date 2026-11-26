/**
 * Expo Push API — чистый транспорт без БД (тестируется с подменённым fetch).
 *
 *   send:     POST https://exp.host/--/api/v2/push/send          ≤ 100 сообщений
 *   receipts: POST https://exp.host/--/api/v2/push/getReceipts   ≤ 1000 id
 *
 * EXPO_ACCESS_TOKEN — опционален (нужен, только если в проекте Expo включена
 * «Enhanced push security»). Документация: https://docs.expo.dev/push-notifications/sending-notifications/
 */

export const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
export const EXPO_SEND_BATCH = 100;
export const EXPO_RECEIPTS_BATCH = 1000;

export type PushKind = 'promo' | 'order' | 'info';

export interface PushData {
  kind: PushKind;
  url?: string;
  promoCode?: string;
  campaignId?: string;
}

export interface PushContent {
  title: string;
  body: string;
  imageUrl?: string | null;
  data: PushData;
}

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  sound: 'default';
  priority: 'high' | 'normal';
  channelId?: string;
  /** Android: большая картинка; iOS — через mutable-content + notification service extension */
  richContent?: { image: string };
  mutableContent?: boolean;
}

export type ExpoTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message?: string; details?: { error?: string } };

export type ExpoReceipt =
  | { status: 'ok' }
  | { status: 'error'; message?: string; details?: { error?: string } };

/** Результат отправки по одному токену. */
export interface TicketResult {
  token: string;
  ticketId: string | null;
  ok: boolean;
  /** Код ошибки Expo (DeviceNotRegistered, MessageTooBig, …) или текст */
  error?: string;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const EXPO_TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_\-:.]{10,}\]$/;

export function isExpoPushToken(token: unknown): token is string {
  return typeof token === 'string' && token.length <= 255 && EXPO_TOKEN_RE.test(token.trim());
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** data → только строки: так приложение читает его одинаково на iOS и Android. */
export function serializeData(data: PushData): Record<string, string> {
  const out: Record<string, string> = { kind: data.kind };
  if (data.url) out.url = data.url;
  if (data.promoCode) out.promoCode = data.promoCode;
  if (data.campaignId) out.campaignId = data.campaignId;
  return out;
}

export function buildMessages(tokens: string[], content: PushContent): ExpoMessage[] {
  const data = serializeData(content.data);
  const image = content.imageUrl?.trim();
  return tokens.map((to) => ({
    to,
    title: content.title,
    body: content.body,
    data,
    sound: 'default',
    priority: content.data.kind === 'order' ? 'high' : 'normal',
    channelId: content.data.kind === 'order' ? 'orders' : 'default',
    ...(image ? { richContent: { image }, mutableContent: true } : {}),
  }));
}

function expoHeaders(accessToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function ticketError(t: { message?: string; details?: { error?: string } }): string {
  return t.details?.error || t.message || 'UnknownError';
}

/**
 * Шлёт сообщения пачками по 100. Ошибка HTTP/сети на пачке не роняет
 * остальные: все токены пачки получают ok=false с текстом ошибки.
 */
export async function sendExpoMessages(
  messages: ExpoMessage[],
  opts: { fetchImpl?: FetchLike; accessToken?: string } = {}
): Promise<TicketResult[]> {
  const doFetch: FetchLike = opts.fetchImpl || ((u, i) => fetch(u, i));
  const accessToken = opts.accessToken ?? process.env.EXPO_ACCESS_TOKEN?.trim() ?? undefined;
  const results: TicketResult[] = [];

  for (const batch of chunk(messages, EXPO_SEND_BATCH)) {
    try {
      const res = await doFetch(EXPO_SEND_URL, {
        method: 'POST',
        headers: expoHeaders(accessToken || undefined),
        body: JSON.stringify(batch),
      });
      const json = (await res.json().catch(() => null)) as { data?: ExpoTicket[]; errors?: any[] } | null;
      const tickets = Array.isArray(json?.data) ? json!.data : null;
      if (!res.ok || !tickets || tickets.length !== batch.length) {
        const reason =
          json?.errors?.[0]?.code || json?.errors?.[0]?.message || `HTTP ${res.status}`;
        batch.forEach((m) => results.push({ token: m.to, ticketId: null, ok: false, error: String(reason) }));
        continue;
      }
      tickets.forEach((t, i) => {
        const token = batch[i].to;
        if (t.status === 'ok') results.push({ token, ticketId: t.id, ok: true });
        else results.push({ token, ticketId: null, ok: false, error: ticketError(t) });
      });
    } catch (e) {
      const reason = (e as Error)?.message || 'NetworkError';
      batch.forEach((m) => results.push({ token: m.to, ticketId: null, ok: false, error: reason }));
    }
  }
  return results;
}

/** Забирает receipts пачками по 1000. Нет receipt в ответе = ещё не готов. */
export async function fetchExpoReceipts(
  ticketIds: string[],
  opts: { fetchImpl?: FetchLike; accessToken?: string } = {}
): Promise<Record<string, ExpoReceipt>> {
  const doFetch: FetchLike = opts.fetchImpl || ((u, i) => fetch(u, i));
  const accessToken = opts.accessToken ?? process.env.EXPO_ACCESS_TOKEN?.trim() ?? undefined;
  const out: Record<string, ExpoReceipt> = {};
  for (const ids of chunk(ticketIds, EXPO_RECEIPTS_BATCH)) {
    const res = await doFetch(EXPO_RECEIPTS_URL, {
      method: 'POST',
      headers: expoHeaders(accessToken || undefined),
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new Error(`Expo getReceipts HTTP ${res.status}`);
    const json = (await res.json()) as { data?: Record<string, ExpoReceipt> };
    Object.assign(out, json.data || {});
  }
  return out;
}

/** Токены, которые надо деактивировать по коду ошибки Expo. */
export function isDeadTokenError(error: string | undefined | null): boolean {
  return error === 'DeviceNotRegistered';
}

export interface ReceiptOutcome {
  ticketId: string;
  status: 'delivered' | 'error';
  error?: string;
}

/**
 * Разбор receipts: тикеты без ответа остаются pending (Expo держит receipts
 * ~24 ч; их добирает следующий запуск крона).
 */
export function interpretReceipts(
  ticketIds: string[],
  receipts: Record<string, ExpoReceipt>
): ReceiptOutcome[] {
  const out: ReceiptOutcome[] = [];
  for (const ticketId of ticketIds) {
    const r = receipts[ticketId];
    if (!r) continue;
    if (r.status === 'ok') out.push({ ticketId, status: 'delivered' });
    else out.push({ ticketId, status: 'error', error: ticketError(r) });
  }
  return out;
}
