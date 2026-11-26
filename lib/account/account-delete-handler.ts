import { NextRequest, NextResponse } from 'next/server';
import {
  deleteAppAccount,
  readBearerToken,
  type AccountDeletionDeps,
  type AccountDeletionResult,
} from './app-account-deletion';
import { getClientIp, logSecurityEvent, rateLimit } from '../security/rate-limit';

/**
 * POST /api/mobile/v1/account/delete
 *
 * Удаляет аккаунт мобильного приложения (Supabase Auth) по его access token.
 * Заголовок: Authorization: Bearer <supabase access_token>.
 * Тело: { "confirm": true, "pushToken"?: "ExponentPushToken[…]" }.
 * Ответ: { success: true, anonymizedOrders, deletedPushDevices }
 *     или { success: false, error } с 400 / 401 / 409 / 429 / 500.
 *
 * Что удаляется и что хранится — docs/app-account-deletion.md.
 */
export async function handleAccountDelete(
  request: NextRequest,
  deps: AccountDeletionDeps
): Promise<NextResponse> {
  const ip = getClientIp(request);
  const limit = rateLimit(`account-delete:${ip}`, 5, 10 * 60 * 1000);
  if (!limit.allowed) {
    logSecurityEvent('account_delete_rate_limited', { ip });
    return NextResponse.json(
      { success: false, error: 'Zu viele Versuche. Bitte versuche es später noch einmal.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  const body = (await request.json().catch(() => null)) as { confirm?: unknown; pushToken?: unknown } | null;
  if (body?.confirm !== true) {
    return NextResponse.json(
      { success: false, error: 'Bestätigung fehlt.' },
      { status: 400 }
    );
  }

  try {
    const result = await deleteAppAccount(
      {
        accessToken: readBearerToken(request.headers.get('authorization')),
        pushToken: typeof body.pushToken === 'string' ? body.pushToken : null,
      },
      deps
    );
    if (result.ok === false) {
      // tsconfig без strict: сужение по `!result.ok` не работает, отсюда явный тип.
      const failure = result as Extract<AccountDeletionResult, { ok: false }>;
      return NextResponse.json({ success: false, error: failure.error }, { status: failure.status });
    }
    logSecurityEvent('account_deleted', {
      ip,
      anonymizedOrders: result.anonymizedOrders,
      deletedPushDevices: result.deletedPushDevices,
    });
    return NextResponse.json({
      success: true,
      anonymizedOrders: result.anonymizedOrders,
      deletedPushDevices: result.deletedPushDevices,
    });
  } catch (error) {
    console.error('account/delete:', error);
    return NextResponse.json(
      { success: false, error: 'Konto konnte nicht gelöscht werden. Bitte versuche es später noch einmal.' },
      { status: 500 }
    );
  }
}
