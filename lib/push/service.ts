/**
 * Push-модуль (H): регистрация устройств, кампании, отправка через Expo,
 * планировщик и receipts. Транспорт — lib/push/expo.ts, проверки — validate.ts.
 */

import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import db from '../db/client';
import { pushCampaigns, pushDevices, pushTickets, type PushCampaign } from '../db/schema';
import {
  buildMessages,
  chunk,
  fetchExpoReceipts,
  isDeadTokenError,
  sendExpoMessages,
  type PushContent,
  type PushData,
  type TicketResult,
} from './expo';
import { planReceiptUpdates, RECEIPT_DELAY_MS, type PendingTicket } from './receipts';
import {
  campaignData,
  selectAudienceTokens,
  type CampaignInput,
  type PushAudience,
  type RegisterInput,
} from './validate';
import { normalizeGermanPhone } from '../sms/phone';

/** Кампания «зависла» в sending дольше — лямбда умерла посреди отправки. */
const STUCK_SENDING_MS = 15 * 60 * 1000;

/* ------------------------------------------------------------ devices */

export async function registerDevice(input: RegisterInput): Promise<void> {
  const now = new Date();
  await db
    .insert(pushDevices)
    .values({
      token: input.token,
      platform: input.platform,
      phoneNumber: input.phoneNumber,
      email: input.email,
      locale: input.locale,
      appVersion: input.appVersion,
      promoOptIn: input.promoOptIn,
      active: true,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: pushDevices.token,
      set: {
        platform: input.platform,
        // Приложение шлёт актуальное состояние: вышел из аккаунта → null.
        phoneNumber: input.phoneNumber,
        email: input.email,
        locale: input.locale,
        appVersion: input.appVersion,
        promoOptIn: input.promoOptIn,
        active: true,
        lastSeenAt: now,
        updatedAt: now,
      },
    });
}

export async function unregisterDevice(token: string): Promise<void> {
  await db
    .update(pushDevices)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(pushDevices.token, token));
}

async function deactivateTokens(tokens: string[]): Promise<void> {
  if (!tokens.length) return;
  for (const part of chunk(tokens, 500)) {
    await db
      .update(pushDevices)
      .set({ active: false, updatedAt: new Date() })
      .where(inArray(pushDevices.token, part));
  }
}

function deadTokensOf(results: TicketResult[]): string[] {
  return results.filter((r) => !r.ok && isDeadTokenError(r.error)).map((r) => r.token);
}

export async function loadAudienceTokens(kind: PushData['kind'], audience: PushAudience): Promise<string[]> {
  const rows = await db
    .select({
      token: pushDevices.token,
      platform: pushDevices.platform,
      active: pushDevices.active,
      promoOptIn: pushDevices.promoOptIn,
    })
    .from(pushDevices)
    .where(eq(pushDevices.active, true));
  return selectAudienceTokens(rows, { kind, audience });
}

export async function audienceStats(): Promise<{
  promo: { all: number; ios: number; android: number };
  info: { all: number; ios: number; android: number };
}> {
  const rows = await db
    .select({
      token: pushDevices.token,
      platform: pushDevices.platform,
      active: pushDevices.active,
      promoOptIn: pushDevices.promoOptIn,
    })
    .from(pushDevices)
    .where(eq(pushDevices.active, true));
  const count = (kind: 'promo' | 'info', audience: PushAudience) =>
    selectAudienceTokens(rows, { kind, audience }).length;
  return {
    promo: { all: count('promo', 'all'), ios: count('promo', 'ios'), android: count('promo', 'android') },
    info: { all: count('info', 'all'), ios: count('info', 'ios'), android: count('info', 'android') },
  };
}

/* ------------------------------------------------------------ campaigns */

export function campaignContent(c: Pick<PushCampaign, 'id' | 'title' | 'body' | 'imageUrl' | 'data'>): PushContent {
  const data = (c.data || {}) as Record<string, string>;
  return {
    title: c.title,
    body: c.body,
    imageUrl: c.imageUrl,
    data: {
      kind: (data.kind as PushData['kind']) || 'promo',
      url: data.url || undefined,
      promoCode: data.promoCode || undefined,
      campaignId: c.id,
    },
  };
}

export async function listCampaigns(limit = 50): Promise<PushCampaign[]> {
  return db.select().from(pushCampaigns).orderBy(desc(pushCampaigns.createdAt)).limit(limit);
}

export async function createCampaign(input: CampaignInput, createdBy?: string | null): Promise<PushCampaign> {
  const [row] = await db
    .insert(pushCampaigns)
    .values({
      title: input.title,
      body: input.body,
      imageUrl: input.imageUrl,
      data: campaignData(input) as unknown as Record<string, string>,
      audience: input.audience,
      status: 'scheduled',
      // «Сейчас» = запланировано на текущий момент: тот же путь, что у крона.
      scheduledAt: input.scheduledAt || new Date(),
      createdBy: createdBy || null,
    })
    .returning();
  return row;
}

export async function cancelCampaign(id: string): Promise<boolean> {
  const rows = await db
    .update(pushCampaigns)
    .set({ status: 'canceled', updatedAt: new Date() })
    .where(and(eq(pushCampaigns.id, id), eq(pushCampaigns.status, 'scheduled')))
    .returning({ id: pushCampaigns.id });
  return rows.length > 0;
}

/**
 * Отправка кампании. Захват атомарный (scheduled → sending), поэтому крон и
 * кнопка «Отправить» не отправят одно и то же дважды.
 */
export async function sendCampaign(id: string): Promise<PushCampaign | null> {
  const [claimed] = await db
    .update(pushCampaigns)
    .set({ status: 'sending', updatedAt: new Date() })
    .where(and(eq(pushCampaigns.id, id), eq(pushCampaigns.status, 'scheduled')))
    .returning();
  if (!claimed) return null;

  try {
    const content = campaignContent(claimed);
    const tokens = await loadAudienceTokens(content.data.kind, claimed.audience as PushAudience);
    const results = tokens.length ? await sendExpoMessages(buildMessages(tokens, content)) : [];

    for (const part of chunk(results, 500)) {
      await db.insert(pushTickets).values(
        part.map((r) => ({
          campaignId: claimed.id,
          token: r.token,
          ticketId: r.ticketId,
          status: r.ok ? 'pending' : 'error',
          error: r.ok ? null : r.error || 'UnknownError',
        }))
      );
    }
    await deactivateTokens(deadTokensOf(results));

    const accepted = results.filter((r) => r.ok).length;
    const errors = results.length - accepted;
    const firstError = results.find((r) => !r.ok)?.error;
    const [updated] = await db
      .update(pushCampaigns)
      .set({
        status: results.length && accepted === 0 ? 'failed' : 'sent',
        sentAt: new Date(),
        recipientCount: tokens.length,
        acceptedCount: accepted,
        errorCount: errors,
        lastError: tokens.length === 0 ? 'Нет получателей' : firstError || null,
        updatedAt: new Date(),
      })
      .where(eq(pushCampaigns.id, claimed.id))
      .returning();
    return updated;
  } catch (e) {
    const [failed] = await db
      .update(pushCampaigns)
      .set({ status: 'failed', lastError: (e as Error)?.message?.slice(0, 500) || 'Error', updatedAt: new Date() })
      .where(eq(pushCampaigns.id, claimed.id))
      .returning();
    return failed;
  }
}

/** Тест-отправка: на один токен или на все активные устройства номера. */
export async function testSend(
  target: { token?: string | null; phoneNumber?: string | null },
  content: PushContent
): Promise<{ results: TicketResult[]; deviceCount: number }> {
  let tokens: string[] = [];
  if (target.token) {
    tokens = [target.token];
  } else if (target.phoneNumber) {
    const phone = normalizeGermanPhone(target.phoneNumber);
    if (!phone) return { results: [], deviceCount: 0 };
    const rows = await db
      .select({ token: pushDevices.token })
      .from(pushDevices)
      .where(and(eq(pushDevices.phoneNumber, phone), eq(pushDevices.active, true)))
      .limit(10);
    tokens = rows.map((r) => r.token);
  }
  if (!tokens.length) return { results: [], deviceCount: 0 };
  const results = await sendExpoMessages(buildMessages(tokens, content));
  await deactivateTokens(deadTokensOf(results));
  return { results, deviceCount: tokens.length };
}

/* ------------------------------------------------------------ cron */

export async function runDueCampaigns(now = new Date()): Promise<{ sent: string[]; stuck: number }> {
  // Зависшие в sending (лямбда упала посреди отправки) — не пересылаем
  // (часть могла уйти), а помечаем failed, чтобы было видно в истории.
  const stuck = await db
    .update(pushCampaigns)
    .set({ status: 'failed', lastError: 'Отправка прервалась', updatedAt: now })
    .where(
      and(
        eq(pushCampaigns.status, 'sending'),
        lte(pushCampaigns.updatedAt, new Date(now.getTime() - STUCK_SENDING_MS))
      )
    )
    .returning({ id: pushCampaigns.id });

  const due = await db
    .select({ id: pushCampaigns.id })
    .from(pushCampaigns)
    .where(and(eq(pushCampaigns.status, 'scheduled'), lte(pushCampaigns.scheduledAt, now)))
    .orderBy(pushCampaigns.scheduledAt)
    .limit(5);

  const sent: string[] = [];
  for (const { id } of due) {
    const res = await sendCampaign(id);
    if (res) sent.push(id);
  }
  return { sent, stuck: stuck.length };
}

async function recountCampaigns(ids: string[]): Promise<void> {
  for (const id of ids) {
    const [agg] = await db
      .select({
        delivered: sql<number>`count(*) filter (where ${pushTickets.status} = 'delivered')::int`,
        errors: sql<number>`count(*) filter (where ${pushTickets.status} = 'error')::int`,
      })
      .from(pushTickets)
      .where(eq(pushTickets.campaignId, id));
    await db
      .update(pushCampaigns)
      .set({ deliveredCount: agg?.delivered ?? 0, errorCount: agg?.errors ?? 0, updatedAt: new Date() })
      .where(eq(pushCampaigns.id, id));
  }
}

export async function checkReceipts(
  now = new Date(),
  limit = 3000
): Promise<{ checked: number; updated: number; deactivated: number }> {
  const rows = await db
    .select({
      id: pushTickets.id,
      campaignId: pushTickets.campaignId,
      token: pushTickets.token,
      ticketId: pushTickets.ticketId,
      createdAt: pushTickets.createdAt,
    })
    .from(pushTickets)
    .where(
      and(
        eq(pushTickets.status, 'pending'),
        lte(pushTickets.createdAt, new Date(now.getTime() - RECEIPT_DELAY_MS))
      )
    )
    .orderBy(pushTickets.createdAt)
    .limit(limit);

  const tickets = rows.filter((r): r is PendingTicket => !!r.ticketId);
  if (!tickets.length) return { checked: 0, updated: 0, deactivated: 0 };

  const receipts = await fetchExpoReceipts(tickets.map((t) => t.ticketId));
  const plan = planReceiptUpdates(tickets, receipts, now);

  // Группируем по (status, error), чтобы не делать по UPDATE на тикет.
  const groups = new Map<string, { status: string; error: string | null; ids: string[] }>();
  for (const u of plan.updates) {
    const key = `${u.status}|${u.error ?? ''}`;
    const g = groups.get(key) || { status: u.status, error: u.error, ids: [] };
    g.ids.push(u.id);
    groups.set(key, g);
  }
  for (const g of Array.from(groups.values())) {
    for (const part of chunk(g.ids, 500)) {
      await db
        .update(pushTickets)
        .set({ status: g.status, error: g.error, checkedAt: now })
        .where(inArray(pushTickets.id, part));
    }
  }

  await deactivateTokens(plan.deadTokens);
  await recountCampaigns(plan.campaignIds);
  return { checked: tickets.length, updated: plan.updates.length, deactivated: plan.deadTokens.length };
}
