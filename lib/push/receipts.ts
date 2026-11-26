/**
 * Разбор receipts Expo в план обновлений БД — чистая функция (тестируется).
 */

import { isDeadTokenError, type ExpoReceipt } from './expo';

/** Expo хранит receipts ~24 ч; после этого ждать бессмысленно. */
export const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
/** Раньше ~15 мин receipts обычно ещё не готовы. */
export const RECEIPT_DELAY_MS = 15 * 60 * 1000;

export interface PendingTicket {
  id: string;
  campaignId: string;
  token: string;
  ticketId: string;
  createdAt: Date;
}

export interface TicketUpdate {
  id: string;
  status: 'delivered' | 'error' | 'expired';
  error: string | null;
}

export interface ReceiptPlan {
  updates: TicketUpdate[];
  /** Токены с DeviceNotRegistered — деактивировать в push_devices */
  deadTokens: string[];
  /** Кампании, чьи счётчики надо пересчитать */
  campaignIds: string[];
}

export function planReceiptUpdates(
  tickets: PendingTicket[],
  receipts: Record<string, ExpoReceipt>,
  now: Date = new Date()
): ReceiptPlan {
  const updates: TicketUpdate[] = [];
  const dead = new Set<string>();
  const campaigns = new Set<string>();

  for (const t of tickets) {
    const r = receipts[t.ticketId];
    if (!r) {
      // Receipt ещё не готов — ждём; после TTL помечаем «нет данных».
      if (now.getTime() - t.createdAt.getTime() > RECEIPT_TTL_MS) {
        updates.push({ id: t.id, status: 'expired', error: 'NoReceipt' });
        campaigns.add(t.campaignId);
      }
      continue;
    }
    campaigns.add(t.campaignId);
    if (r.status === 'ok') {
      updates.push({ id: t.id, status: 'delivered', error: null });
    } else {
      const code = r.details?.error || r.message || 'UnknownError';
      updates.push({ id: t.id, status: 'error', error: code });
      if (isDeadTokenError(code)) dead.add(t.token);
    }
  }

  return { updates, deadTokens: Array.from(dead), campaignIds: Array.from(campaigns) };
}
