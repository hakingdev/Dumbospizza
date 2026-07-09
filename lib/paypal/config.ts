import { z } from 'zod';

/**
 * Конфиг PayPal из env (см. .env.example, блок PayPal).
 *
 * Валидация — zod, fail-closed: любой отсутствующий ключ приводит к ошибке при
 * ПЕРВОМ обращении к PayPal-коду. «Проверку на старте» из ТЗ здесь заменяет
 * ленивая проверка при первом использовании — это паттерн всей кодовой базы
 * (Next.js собирает роуты без env, а на Vercel у serverless-функций нет
 * общего «старта приложения»).
 *
 * PAYPAL_CLIENT_SECRET никогда не логируется и не покидает сервер: в клиентский
 * бандл попадают только NEXT_PUBLIC_*-переменные (клиенту нужен лишь client id).
 */

const PAYPAL_API_BASE = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
} as const;

/**
 * Валюта магазина. У заказов нет колонки currency (всё в EUR) — фиксируем
 * серверную константу; NEXT_PUBLIC_PAYPAL_CURRENCY обязана совпадать с ней.
 */
export const PAYPAL_CURRENCY = 'EUR';

const envSchema = z.object({
  env: z.enum(['sandbox', 'live']),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  webhookId: z.string().min(1),
});

export interface PayPalConfig {
  env: 'sandbox' | 'live';
  clientId: string;
  clientSecret: string;
  webhookId: string;
  baseUrl: string;
}

let cachedConfig: PayPalConfig | null = null;

/** Читает и валидирует PayPal-env. Бросает с перечнем ОТСУТСТВУЮЩИХ КЛЮЧЕЙ (без значений). */
export function getPayPalConfig(): PayPalConfig {
  if (cachedConfig) return cachedConfig;

  const parsed = envSchema.safeParse({
    env: process.env.PAYPAL_ENV || 'sandbox',
    clientId: process.env.PAYPAL_CLIENT_ID,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET,
    webhookId: process.env.PAYPAL_WEBHOOK_ID,
  });

  if (!parsed.success) {
    const fieldToEnv: Record<string, string> = {
      env: 'PAYPAL_ENV',
      clientId: 'PAYPAL_CLIENT_ID',
      clientSecret: 'PAYPAL_CLIENT_SECRET',
      webhookId: 'PAYPAL_WEBHOOK_ID',
    };
    const missing = parsed.error.issues
      .map((i) => fieldToEnv[String(i.path[0])] || String(i.path[0]))
      .join(', ');
    // Значения переменных в сообщение не попадают — только имена ключей.
    throw new Error(`PayPal ist nicht konfiguriert: ${missing} fehlt/ungültig`);
  }

  // tsconfig strict:false → zod-инференс делает поля optional; после успешного
  // safeParse они гарантированно заполнены.
  const data = parsed.data as Required<typeof parsed.data>;
  cachedConfig = {
    env: data.env,
    clientId: data.clientId,
    clientSecret: data.clientSecret,
    webhookId: data.webhookId,
    baseUrl: PAYPAL_API_BASE[data.env],
  };
  return cachedConfig;
}

/** Сброс кэша конфига (только для тестов: vi.stubEnv между кейсами). */
export function resetPayPalConfigForTests(): void {
  cachedConfig = null;
}
