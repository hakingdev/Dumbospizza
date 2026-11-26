import { listMerchantPaymentMethods } from '../sumup';

/**
 * Merchant-level allowlist SumUp с кэшем в памяти (~5 минут).
 *
 * Общий для прокси /api/payments/sumup/payment-methods (чекаут сайта) и
 * /api/payments/methods (мобильное приложение): список меняется только
 * настройками мерчант-аккаунта, а оба клиента дёргают его при каждом входе
 * на шаг оплаты. Сбой SumUp пробрасывается — вызывающий решает, уходить ли
 * в фолбэк resolveVisibleGroups(null).
 */
const CACHE_TTL_MS = 5 * 60_000;
let cache: { key: string; at: number; methods: string[] } | null = null;

export async function getMerchantPaymentMethodsCached(opts: {
  amount?: number;
  currency?: string;
}): Promise<string[]> {
  const amount = opts.amount != null && Number.isFinite(opts.amount) ? opts.amount : undefined;
  const currency = opts.currency || 'EUR';
  const key = `${amount ?? ''}:${currency}`;

  if (cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.methods;
  }

  const methods = await listMerchantPaymentMethods({ amount, currency });
  cache = { key, at: Date.now(), methods };
  return methods;
}

/** Разбор ?amount= из query: пусто/мусор → undefined (allowlist без суммы). */
export function parseAmountParam(raw: string | null): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
