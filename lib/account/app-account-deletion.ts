/**
 * Удаление аккаунта мобильного приложения (App Store Guideline 5.1.1(v)).
 *
 * Аккаунты приложения — это пользователи Supabase Auth (auth.users) в проекте
 * сайта. С таблицей `users` сайта они НЕ связаны: сайт входит по своему cookie
 * (lib/customer-auth.ts), а заказы из приложения приходят как гостевые
 * (orders.user = NULL, контакт — phone/email из тела заказа). Поэтому к аккаунту
 * приложения относятся:
 *
 *   1. сам пользователь Supabase Auth (email, пароль-хеш, user_metadata с
 *      именем/телефоном, identities, сессии) → удаляется полностью;
 *   2. push-устройства с его email или с токеном этого устройства → удаляются;
 *   3. его завершённые заказы из приложения (source='app', тот же email) →
 *      НЕ удаляются: это Buchungsbelege, хранятся 10 лет (§ 147 AO, § 257 HGB;
 *      DSGVO Art. 17 Abs. 3 lit. b). Контактные данные в них обезличиваются,
 *      суммы, позиции, оплата и номер заказа остаются для бухгалтерии.
 *
 * Логика вынесена из роута с зависимостями через параметры, чтобы её можно было
 * проверить в vitest без БД и без Supabase.
 */

/** Статусы, при которых заказ ещё в работе: обезличивать нельзя, кухне нужен контакт. */
export const OPEN_ORDER_STATUSES = [
  'pending_payment',
  'new',
  'preparing',
  'ready_for_delivery',
  'delivering',
] as const;

/** Подпись вместо имени клиента в обезличенных заказах. */
export const ANONYMIZED_CUSTOMER_NAME = 'Gelöschtes Konto';

export interface AppAccount {
  id: string;
  email: string | null;
  /** Только подтверждённый email связывает аккаунт с заказами (см. ниже). */
  emailConfirmed: boolean;
}

export interface AccountDeletionDeps {
  /** Проверить access token Supabase. null — токен недействителен/истёк. */
  verifyAccessToken(token: string): Promise<AppAccount | null>;
  /** Есть ли у email незавершённые заказы из приложения. */
  hasOpenAppOrders(email: string): Promise<boolean>;
  /** Обезличить завершённые заказы из приложения. Возвращает число строк. */
  anonymizeAppOrders(email: string): Promise<number>;
  /** Удалить push-устройства по email и/или токену. Возвращает число строк. */
  deletePushDevices(params: { email: string | null; token: string | null }): Promise<number>;
  /** Удалить пользователя Supabase Auth (жёстко, не soft delete). */
  deleteAuthUser(userId: string): Promise<void>;
}

export type AccountDeletionResult =
  | { ok: true; anonymizedOrders: number; deletedPushDevices: number }
  | { ok: false; status: 401 | 409; error: string };

/** Bearer-токен из заголовка Authorization (или null). */
export function readBearerToken(header: string | null | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? '');
  return match ? match[1]! : null;
}

export function normalizeAccountEmail(email: string | null | undefined): string | null {
  const value = String(email ?? '').trim().toLowerCase();
  return value || null;
}

/** Push-токены Expo, как их принимает /api/mobile/v1/push/register. */
const EXPO_PUSH_TOKEN_RE = /^Expo(nent)?PushToken\[[^\]]+\]$/;

export function normalizePushToken(value: unknown): string | null {
  return typeof value === 'string' && EXPO_PUSH_TOKEN_RE.test(value.trim()) ? value.trim() : null;
}

/**
 * Порядок важен: сначала данные в нашей БД, потом пользователь Auth. Если БД
 * упадёт, аккаунт останется и клиент сможет повторить запрос тем же токеном;
 * в обратном порядке токен после удаления уже не прошёл бы проверку, и хвосты
 * в БД остались бы навсегда. Все шаги идемпотентны.
 */
export async function deleteAppAccount(
  input: { accessToken: string | null; pushToken?: string | null },
  deps: AccountDeletionDeps
): Promise<AccountDeletionResult> {
  if (!input.accessToken) {
    return { ok: false, status: 401, error: 'Nicht angemeldet' };
  }

  const account = await deps.verifyAccessToken(input.accessToken);
  if (!account) {
    return { ok: false, status: 401, error: 'Sitzung abgelaufen. Bitte melde dich erneut an.' };
  }

  const email = normalizeAccountEmail(account.email);
  // Неподтверждённый email мог ввести кто угодно: по нему не трогаем чужие
  // заказы и устройства. Устройство, с которого идёт запрос, — по его токену.
  const linkedEmail = account.emailConfirmed ? email : null;

  if (linkedEmail && (await deps.hasOpenAppOrders(linkedEmail))) {
    return {
      ok: false,
      status: 409,
      error:
        'Du hast noch eine laufende Bestellung. Bitte lösche dein Konto, sobald sie abgeschlossen ist.',
    };
  }

  const anonymizedOrders = linkedEmail ? await deps.anonymizeAppOrders(linkedEmail) : 0;
  const deletedPushDevices = await deps.deletePushDevices({
    email: linkedEmail,
    token: normalizePushToken(input.pushToken),
  });
  await deps.deleteAuthUser(account.id);

  return { ok: true, anonymizedOrders, deletedPushDevices };
}
