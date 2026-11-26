/**
 * Реальные зависимости deleteAppAccount: Supabase Auth (service_role, только на
 * сервере) и Postgres через Drizzle. Логика и порядок шагов — в
 * app-account-deletion.ts.
 */
import { and, eq, inArray, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { orders, pushDevices } from '../db/schema';
import { getSupabaseAdmin } from '../supabase/admin';
import {
  ANONYMIZED_CUSTOMER_NAME,
  OPEN_ORDER_STATUSES,
  type AccountDeletionDeps,
} from './app-account-deletion';

const appOrdersOf = (email: string) =>
  and(eq(orders.source, 'app'), sql`lower(${orders.email}) = ${email}`);

export const accountDeletionDeps: AccountDeletionDeps = {
  async verifyAccessToken(token) {
    // getUser спрашивает GoTrue: проверяет подпись, срок и что сессия не отозвана.
    const { data, error } = await getSupabaseAdmin().auth.getUser(token);
    if (error || !data.user) return null;
    return {
      id: data.user.id,
      email: data.user.email ?? null,
      emailConfirmed: Boolean(data.user.email_confirmed_at),
    };
  },

  async hasOpenAppOrders(email) {
    const rows = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(appOrdersOf(email), inArray(orders.status, [...OPEN_ORDER_STATUSES])))
      .limit(1);
    return rows.length > 0;
  },

  async anonymizeAppOrders(email) {
    // Остаются: номер, позиции, суммы, скидки, оплата, статус, даты, канал.
    // Индекс и город остаются для статистики зон доставки; улица, дом,
    // телефон, email, имя, комментарии и координаты (eta_analysis) уходят.
    const rows = await db
      .update(orders)
      .set({
        customerName: ANONYMIZED_CUSTOMER_NAME,
        phoneNumber: '',
        email: null,
        deliveryAddress: sql`CASE WHEN ${orders.deliveryAddress} IS NULL THEN NULL ELSE jsonb_build_object(
          'street', '', 'houseNumber', '',
          'postalCode', coalesce(${orders.deliveryAddress}->>'postalCode', ''),
          'city', coalesce(${orders.deliveryAddress}->>'city', '')
        ) END`,
        notes: null,
        etaAnalysis: null,
        smsMarketingConsent: false,
        smsConsentAt: null,
        smsConsentText: null,
        updatedAt: new Date(),
      })
      .where(and(appOrdersOf(email), notInArray(orders.status, [...OPEN_ORDER_STATUSES])))
      .returning({ id: orders.id });
    return rows.length;
  },

  async deletePushDevices({ email, token }) {
    const conditions: SQL[] = [];
    if (email) conditions.push(sql`lower(${pushDevices.email}) = ${email}`);
    if (token) conditions.push(eq(pushDevices.token, token));
    if (!conditions.length) return 0;
    const rows = await db
      .delete(pushDevices)
      .where(or(...conditions))
      .returning({ id: pushDevices.id });
    return rows.length;
  },

  async deleteAuthUser(userId) {
    // Жёсткое удаление: auth.users + identities + sessions + refresh tokens.
    const { error } = await getSupabaseAdmin().auth.admin.deleteUser(userId);
    if (error) throw error;
  },
};
