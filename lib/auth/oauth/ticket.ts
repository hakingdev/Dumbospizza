/**
 * «Талон» незавершённой регистрации через Google/Apple.
 *
 * Зачем он вообще нужен: в users колонка `phone_number` — NOT NULL UNIQUE, а
 * программа лояльности заводится по телефону (createLoyaltyProgram). Ни Google,
 * ни Apple телефон не отдают. Поэтому строку в users НЕ создаём, пока клиент не
 * укажет телефон: подтверждённая личность от провайдера лежит в подписанной
 * cookie, и только шаг /account/complete-profile превращает её в аккаунт.
 *
 * Альтернатива «сделать phone_number nullable» дороже: миграция плюс ревизия
 * всех мест, где телефон читается как гарантированно существующий, плюс
 * лояльность без ключа.
 */
import jwt from 'jsonwebtoken';
import { NextResponse, type NextRequest } from 'next/server';
import { getAuthSecret } from '../../customer-auth';
import type { OAuthIdentity } from './id-token';
import type { OAuthProvider } from './providers';

export const OAUTH_TICKET_COOKIE = 'dp_oauth_ticket';
const TICKET_TTL_SECONDS = 30 * 60;
const AUDIENCE = 'customer-oauth-registration';

export interface RegistrationTicket {
  provider: OAuthProvider;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export function setTicketCookie(
  response: NextResponse,
  identity: OAuthIdentity,
  name?: string | null
): NextResponse {
  const ticket: RegistrationTicket = {
    provider: identity.provider,
    subject: identity.subject,
    email: identity.email,
    emailVerified: identity.emailVerified,
    // Apple присылает имя ТОЛЬКО при первой авторизации и не в id_token, а в
    // теле form_post — поэтому его можно передать отдельным аргументом.
    name: name || identity.name,
  };

  const token = jwt.sign({ ...ticket, aud: AUDIENCE }, getAuthSecret(), {
    expiresIn: TICKET_TTL_SECONDS,
  });

  response.cookies.set(OAUTH_TICKET_COOKIE, token, {
    httpOnly: true,
    // Талон читается только нашим же POST-ом с /account/complete-profile —
    // это same-site, Lax достаточно.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TICKET_TTL_SECONDS,
  });
  return response;
}

export function readTicket(request: NextRequest): RegistrationTicket | null {
  const token = request.cookies.get(OAUTH_TICKET_COOKIE)?.value;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, getAuthSecret(), {
      audience: AUDIENCE,
    }) as jwt.JwtPayload & Partial<RegistrationTicket>;
    if (!payload.provider || !payload.subject) return null;
    return {
      provider: payload.provider,
      subject: payload.subject,
      email: payload.email ?? null,
      emailVerified: Boolean(payload.emailVerified),
      name: payload.name ?? null,
    };
  } catch {
    return null;
  }
}

export function clearTicketCookie(response: NextResponse): NextResponse {
  response.cookies.set(OAUTH_TICKET_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
