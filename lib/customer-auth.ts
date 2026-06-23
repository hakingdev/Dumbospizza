/**
 * Лёгкая клиентская сессия (отдельно от admin-NextAuth).
 *
 * Вход по email+паролю. После успешного входа выдаётся подписанный JWT в
 * httpOnly-cookie `dp_customer`. user_id берётся ТОЛЬКО из этого cookie —
 * никогда из тела запроса, — поэтому клиент видит лишь свои данные.
 *
 * NextAuth (lib/auth.ts) не трогаем: он настроен под admin/staff. Здесь —
 * независимый канал для роли customer.
 */
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { NextResponse, type NextRequest } from 'next/server';

export const CUSTOMER_COOKIE = 'dp_customer';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 дней
const AUDIENCE = 'customer';

function getSecret(): string {
  const secret =
    process.env.NEXTAUTH_SECRET ||
    (process.env.NODE_ENV === 'production' ? undefined : 'pizza-delivery-secret');
  if (!secret) throw new Error('NEXTAUTH_SECRET не задан');
  return secret;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash?: string | null): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

export function signCustomerToken(userId: string): string {
  return jwt.sign({ sub: userId, aud: AUDIENCE }, getSecret(), {
    expiresIn: MAX_AGE_SECONDS,
  });
}

export function verifyCustomerToken(token: string): { userId: string } | null {
  try {
    const payload = jwt.verify(token, getSecret(), { audience: AUDIENCE }) as jwt.JwtPayload;
    if (payload && typeof payload.sub === 'string') return { userId: payload.sub };
    return null;
  } catch {
    return null;
  }
}

/** Прочитать клиентскую сессию из cookie запроса. Возвращает { userId } или null. */
export function getCustomerSession(request: NextRequest): { userId: string } | null {
  const token = request.cookies.get(CUSTOMER_COOKIE)?.value;
  if (!token) return null;
  return verifyCustomerToken(token);
}

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

/** Установить cookie сессии на ответе. */
export function setCustomerCookie(response: NextResponse, userId: string): NextResponse {
  response.cookies.set(CUSTOMER_COOKIE, signCustomerToken(userId), {
    ...cookieOptions,
    maxAge: MAX_AGE_SECONDS,
  });
  return response;
}

/** Очистить cookie сессии. */
export function clearCustomerCookie(response: NextResponse): NextResponse {
  response.cookies.set(CUSTOMER_COOKIE, '', { ...cookieOptions, maxAge: 0 });
  return response;
}

/** Нормализация телефона (как в роутах заказов). */
export function normalizePhone(value?: string | null): string {
  return String(value || '').replace(/[^\d+]/g, '');
}

/** Нормализация email. */
export function normalizeEmail(value?: string | null): string {
  return String(value || '').trim().toLowerCase();
}
