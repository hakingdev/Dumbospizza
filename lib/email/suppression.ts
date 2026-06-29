import { inArray } from 'drizzle-orm';
import db from '../db/client';
import { emailUnsubscribes } from '../db/schema';

/**
 * Suppression-Liste отписавшихся email. Используется рассылкой, чтобы
 * автоматически исключать адреса, по которым клиент отказался (§ 7 Abs. 3 UWG).
 */

/** Добавляет адрес в список отписок (идемпотентно). */
export async function addUnsubscribe(email: string, source = 'campaign-link'): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  await db
    .insert(emailUnsubscribes)
    .values({ email: normalized, source })
    .onConflictDoNothing({ target: emailUnsubscribes.email });
}

/** Возвращает множество отписавшихся адресов из переданного списка (lowercase). */
export async function getUnsubscribedSet(emails: string[]): Promise<Set<string>> {
  const normalized = Array.from(
    new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))
  );
  if (normalized.length === 0) return new Set();

  const rows = await db
    .select({ email: emailUnsubscribes.email })
    .from(emailUnsubscribes)
    .where(inArray(emailUnsubscribes.email, normalized));

  return new Set(rows.map((r) => r.email));
}

/** Отфильтровывает отписавшихся из списка получателей. */
export async function filterUnsubscribed(emails: string[]): Promise<string[]> {
  const blocked = await getUnsubscribedSet(emails);
  if (blocked.size === 0) return emails;
  return emails.filter((e) => !blocked.has(e.trim().toLowerCase()));
}
