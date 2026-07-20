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
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { NextResponse, type NextRequest } from 'next/server';

export const CUSTOMER_COOKIE = 'dp_customer';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 дней
const AUDIENCE = 'customer';

/** Время жизни ссылки восстановления пароля. */
export const RESET_TOKEN_TTL_MINUTES = 60;

/**
 * Секрет подписи всех клиентских токенов (сессия, OAuth-транзакция, ticket).
 * Один на все — чтобы не плодить переменные окружения; аудитории (`aud`)
 * разводят токены между собой.
 */
export function getAuthSecret(): string {
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

/**
 * Сырой токен восстановления — уходит ТОЛЬКО в ссылку письма, в БД не попадает.
 * 32 байта энтропии: перебор бессмыслен, поэтому TTL можно держать в часах.
 */
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * В колонку `passwordResetToken` пишем SHA-256 от токена, а не сам токен: дамп
 * БД (или доступ к ней через админку) тогда не даёт возможности сбросить чужой
 * пароль. Хеш быстрый и без соли осознанно — токен и так случайный, радужные
 * таблицы к 256 битам неприменимы.
 */
export function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Момент истечения ссылки восстановления. */
export function resetTokenExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
}

export function signCustomerToken(userId: string): string {
  return jwt.sign({ sub: userId, aud: AUDIENCE }, getAuthSecret(), {
    expiresIn: MAX_AGE_SECONDS,
  });
}

export function verifyCustomerToken(token: string): { userId: string } | null {
  try {
    const payload = jwt.verify(token, getAuthSecret(), { audience: AUDIENCE }) as jwt.JwtPayload;
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
