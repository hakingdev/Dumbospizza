/**
 * Сопоставление личности от провайдера с аккаунтом в нашей БД.
 *
 * Порядок поиска принципиален:
 *  1) по (provider, subject) — единственный по-настоящему стабильный ключ;
 *  2) по ПОДТВЕРЖДЁННОМУ email — так вход через Google подхватывает аккаунт,
 *     заведённый когда-то паролем;
 *  3) иначе — регистрации ещё нет, нужен телефон (см. ticket.ts).
 *
 * Шаг 2 работает ТОЛЬКО при email_verified. Иначе достаточно было бы завести у
 * провайдера аккаунт с чужим адресом, чтобы войти в чужой кабинет.
 */
import { connectToDatabase } from '../../models';
import { User } from '../../models/user.model';
import { UserIdentity } from '../../models/user-identity.model';
import { createLoyaltyProgram } from '../../loyalty';
import { normalizeEmail, normalizePhone } from '../../customer-auth';
import type { OAuthIdentity } from './id-token';
import type { RegistrationTicket } from './ticket';

export type ResolvedAccount =
  /** Нашли (или связали) существующий аккаунт — можно выдавать сессию. */
  | { kind: 'user'; userId: string }
  /** Личность подтверждена, но аккаунта нет: нужен телефон. */
  | { kind: 'needs-profile' };

async function linkIdentity(
  userId: string,
  provider: string,
  subject: string,
  email: string | null
): Promise<void> {
  await new UserIdentity({ user: userId, provider, subject, email }).save();
}

export async function resolveAccount(identity: OAuthIdentity): Promise<ResolvedAccount> {
  await connectToDatabase();

  // 1) Уже привязанная учётка провайдера.
  const existing = await UserIdentity.findOne({
    provider: identity.provider,
    subject: identity.subject,
  });
  if (existing) {
    const user = await User.findById(existing.user);
    // Аккаунт мог быть удалён — тогда привязка мусорная, идём дальше как новые.
    if (user) return { kind: 'user', userId: user._id.toString() };
  }

  // 2) Тот же человек, но заходил раньше по паролю.
  if (identity.email && identity.emailVerified) {
    const byEmail = await User.findOne({ email: normalizeEmail(identity.email) });
    if (byEmail) {
      const userId = byEmail._id.toString();
      if (!existing) {
        await linkIdentity(userId, identity.provider, identity.subject, identity.email);
      }
      return { kind: 'user', userId };
    }
  }

  return { kind: 'needs-profile' };
}

// Дискриминант строковый, а не `ok: boolean`: в проекте strict=false, и по
// булеву литералу TypeScript union не сужает.
export type CompletionResult =
  | { kind: 'created'; userId: string }
  | { kind: 'error'; status: number; error: string };

/**
 * Завершение регистрации: талон + телефон → аккаунт.
 *
 * Телефон может уже существовать — его создают заказы «по телефону» без пароля.
 * Такой аккаунт забираем себе (как делает /api/customer/auth/register), но
 * только если он БЕЗ пароля: иначе подбором номера можно было бы въехать в
 * чужой кабинет.
 */
export async function completeRegistration(
  ticket: RegistrationTicket,
  input: { name?: string | null; phoneNumber: string }
): Promise<CompletionResult> {
  await connectToDatabase();

  const phoneNumber = normalizePhone(input.phoneNumber);
  if (!phoneNumber || phoneNumber.length < 6) {
    return { kind: 'error', status: 400, error: 'Bitte gültige Telefonnummer angeben' };
  }

  const name = String(input.name || ticket.name || '').trim();
  if (!name) {
    return { kind: 'error', status: 400, error: 'Bitte Namen angeben' };
  }

  // Пока клиент заполнял телефон, он мог войти в другой вкладке — тогда
  // привязка уже есть и второй раз создавать аккаунт не нужно.
  const alreadyLinked = await UserIdentity.findOne({
    provider: ticket.provider,
    subject: ticket.subject,
  });
  if (alreadyLinked) {
    const user = await User.findById(alreadyLinked.user);
    if (user) return { kind: 'created', userId: user._id.toString() };
  }

  const email = ticket.email ? normalizeEmail(ticket.email) : null;

  // email пишем, только если он свободен: колонка уникальная, а адрес мог быть
  // занят другим аккаунтом (или неподтверждён — тогда он не наш, чтобы им
  // распоряжаться). Аккаунт спокойно живёт и без email — вход идёт по провайдеру.
  let emailToUse: string | null = null;
  if (email && ticket.emailVerified) {
    const taken = await User.findOne({ email });
    if (!taken) emailToUse = email;
  }

  let user = await User.findOne({ phoneNumber }).select('+password');

  if (user) {
    if (user.password) {
      return {
        kind: 'error',
        status: 409,
        error:
          'Diese Telefonnummer gehört zu einem Konto mit Passwort. ' +
          'Bitte melden Sie sich mit E-Mail und Passwort an.',
      };
    }
    // claim: аккаунт из телефонных заказов получает имя/email и привязку.
    user.name = user.name || name;
    if (!user.email && emailToUse) user.email = emailToUse;
    user.role = user.role || 'customer';
    await user.save();
  } else {
    user = new User({
      name,
      email: emailToUse,
      phoneNumber,
      role: 'customer',
    });
    await user.save();
  }

  const userId = user._id.toString();
  await linkIdentity(userId, ticket.provider, ticket.subject, email);

  try {
    await createLoyaltyProgram(userId, phoneNumber);
  } catch (e) {
    // Лояльность не должна ронять регистрацию — заведём при первом заказе.
    console.error('createLoyaltyProgram on oauth register:', e);
  }

  return { kind: 'created', userId };
}
