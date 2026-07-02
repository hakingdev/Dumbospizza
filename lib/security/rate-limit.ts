import { NextRequest } from 'next/server';

/**
 * Лёгкий rate-limit + структурное логирование для чувствительных эндпоинтов
 * (выборка заказа, счёт, повтор). Цель — замедлить перебор orderId/номера
 * телефона и дать сигнал для мониторинга.
 *
 * ВАЖНО (serverless): счётчик хранится в памяти инстанса и НЕ делится между
 * лямбдами Vercel. Это осознанный компромисс: он режет всплески в рамках одного
 * тёплого инстанса и почти ничего не стоит. Для строгой защиты в проде нужен
 * общий стор (Upstash Redis / Vercel KV) — тогда достаточно заменить тело
 * rateLimit() на инкремент в KV с TTL. Интерфейс менять не придётся.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

function sweep(now: number) {
  // Периодическая чистка протухших корзин, чтобы Map не рос бесконечно.
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  // Удаление во время forEach по Map безопасно.
  buckets.forEach((bucket, key) => {
    if (bucket.resetAt <= now) buckets.delete(key);
  });
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Фиксированное окно: не более `limit` запросов на `key` за `windowMs`.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
}

/** IP клиента за прокси Vercel (x-forwarded-for → первый адрес). */
export function getClientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

/**
 * Структурный лог security-события. На Vercel уходит в лог-дрейн — можно
 * навесить алерт на подстроку "[SECURITY]" и сгруппировать по event/ip.
 */
export function logSecurityEvent(
  event: string,
  data: Record<string, unknown> = {}
): void {
  try {
    console.warn(`[SECURITY] ${event} ${JSON.stringify(data)}`);
  } catch {
    console.warn(`[SECURITY] ${event}`);
  }
}
