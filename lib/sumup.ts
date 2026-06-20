/**
 * Клиент SumUp Online Payments (Apple Pay / Google Pay / карта через Payment Widget).
 *
 * Поток: сервер создаёт checkout (createSumUpCheckout) → фронт монтирует виджет
 * по checkoutId → после оплаты сервер ПРОВЕРЯЕТ статус (getSumUpCheckout) и только
 * тогда финализирует заказ. Источник истины об оплате — всегда серверная проверка,
 * а не колбэк виджета.
 *
 * Ключи в env: SUMUP_SECRET_KEY (sup_sk_…), SUMUP_MERCHANT_CODE (merchant_code).
 */

const SUMUP_API_BASE = 'https://api.sumup.com/v0.1';

export type SumUpCheckoutStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED';

export interface SumUpCheckout {
  id: string;
  checkout_reference: string;
  status: SumUpCheckoutStatus;
  amount: number;
  currency: string;
  merchant_code: string;
  transactions?: Array<{
    id: string;
    status: string;
    amount: number;
    currency: string;
    payment_type?: string;
  }>;
}

function getSumUpConfig() {
  const secretKey = process.env.SUMUP_SECRET_KEY || '';
  const merchantCode = process.env.SUMUP_MERCHANT_CODE || '';
  if (!secretKey) throw new Error('SUMUP_SECRET_KEY is not configured');
  if (!merchantCode) throw new Error('SUMUP_MERCHANT_CODE is not configured');
  return { secretKey, merchantCode };
}

/** Денежная сумма в «крупных единицах» (евро) с округлением до 2 знаков. */
function toMajorUnits(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Создаёт checkout в SumUp. Сумма — в евро (major units), не в центах.
 * @param reference checkout_reference (используем orderNumber, ≤ 90 символов)
 */
export async function createSumUpCheckout(params: {
  reference: string;
  amount: number;
  currency?: string;
  description?: string;
  /** URL, куда SumUp вернёт плательщика после оплаты (для hosted/3DS-флоу). */
  redirectUrl?: string;
}): Promise<SumUpCheckout> {
  const { secretKey, merchantCode } = getSumUpConfig();

  const res = await fetch(`${SUMUP_API_BASE}/checkouts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      checkout_reference: params.reference,
      amount: toMajorUnits(params.amount),
      currency: params.currency || 'EUR',
      merchant_code: merchantCode,
      description: params.description,
      redirect_url: params.redirectUrl,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`SumUp create checkout failed (${res.status}): ${text}`);
  }
  return res.json();
}

/** Получает актуальное состояние checkout по id (для серверной проверки оплаты). */
export async function getSumUpCheckout(id: string): Promise<SumUpCheckout> {
  const { secretKey } = getSumUpConfig();

  const res = await fetch(`${SUMUP_API_BASE}/checkouts/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`SumUp get checkout failed (${res.status}): ${text}`);
  }
  return res.json();
}

/**
 * Безопасная проверка оплаты: статус PAID, тот же checkout_reference и сумма,
 * совпадающая с заказом (допуск 1 цент на округления). Используется на сервере,
 * чтобы колбэк виджета нельзя было подделать.
 */
export function isSumUpCheckoutPaid(
  checkout: Pick<SumUpCheckout, 'status' | 'checkout_reference' | 'amount'>,
  expected: { reference: string; amount: number }
): boolean {
  if (checkout.status !== 'PAID') return false;
  if (checkout.checkout_reference !== expected.reference) return false;
  if (Math.abs(checkout.amount - toMajorUnits(expected.amount)) > 0.01) return false;
  return true;
}
