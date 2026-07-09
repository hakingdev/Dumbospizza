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

/** Ошибка SumUp API с HTTP-статусом: вебхук различает 404 (мусорный id) и 5xx (ретрай). */
export class SumUpApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'SumUpApiError';
  }
}

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
  /**
   * Бэкенд-колбэк SumUp («webhook»): по доке create-checkout `return_url` —
   * "backend callback URL used by SumUp to notify your platform about
   * processing updates for the checkout". Задаётся НА КАЖДЫЙ checkout при
   * создании — регистрация в каком-либо кабинете не требуется.
   */
  returnUrl?: string;
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
      return_url: params.returnUrl,
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
    throw new SumUpApiError(`SumUp get checkout failed (${res.status}): ${text}`, res.status);
  }
  return res.json();
}

/**
 * Merchant-level allowlist методов онлайн-оплаты:
 * GET /v0.1/merchants/{merchant_code}/payment-methods?amount&currency
 * → { available_payment_methods: [{ id }] }. SumUp требует трактовать ответ
 * как allowlist — чекаут показывает и монтирует только методы из него.
 */
export async function listMerchantPaymentMethods(params?: {
  amount?: number;
  currency?: string;
}): Promise<string[]> {
  const { secretKey, merchantCode } = getSumUpConfig();

  const query = new URLSearchParams();
  if (params?.amount != null && Number.isFinite(params.amount)) {
    query.set('amount', String(toMajorUnits(params.amount)));
  }
  if (params?.currency) query.set('currency', params.currency);
  const qs = query.toString();

  const res = await fetch(
    `${SUMUP_API_BASE}/merchants/${encodeURIComponent(merchantCode)}/payment-methods${qs ? `?${qs}` : ''}`,
    { headers: { Authorization: `Bearer ${secretKey}` } }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new SumUpApiError(`SumUp list payment methods failed (${res.status}): ${text}`, res.status);
  }
  const data = await res.json();
  const items = Array.isArray(data?.available_payment_methods) ? data.available_payment_methods : [];
  return items
    .map((m: unknown) => String((m as { id?: unknown })?.id ?? ''))
    .filter((id: string) => id.length > 0);
}

/**
 * Checkout'ы по checkout_reference (GET /v0.1/checkouts?checkout_reference=…).
 * reference = наш orders.id (ключ идемпотентности): перед созданием нового
 * checkout переиспользуем существующий PENDING с той же суммой — повторные
 * попытки оплаты одного заказа не плодят дублей на стороне SumUp.
 */
export async function listSumUpCheckoutsByReference(reference: string): Promise<SumUpCheckout[]> {
  const { secretKey } = getSumUpConfig();

  const res = await fetch(
    `${SUMUP_API_BASE}/checkouts?checkout_reference=${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${secretKey}` } }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`SumUp list checkouts failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Безопасная проверка оплаты: статус PAID, checkout_reference из ожидаемых
 * (orders.id — новая схема; orderNumber — легаси-checkout'ы, созданные до
 * перехода) и сумма, совпадающая с заказом (допуск 1 цент на округления).
 * Используется на сервере, чтобы колбэк виджета нельзя было подделать.
 */
export function isSumUpCheckoutPaid(
  checkout: Pick<SumUpCheckout, 'status' | 'checkout_reference' | 'amount'>,
  expected: { reference?: string; references?: (string | null | undefined)[]; amount: number }
): boolean {
  if (checkout.status !== 'PAID') return false;
  const allowed = new Set(
    [expected.reference, ...(expected.references || [])].filter(
      (r): r is string => typeof r === 'string' && r.length > 0
    )
  );
  if (!allowed.has(checkout.checkout_reference)) return false;
  if (Math.abs(checkout.amount - toMajorUnits(expected.amount)) > 0.01) return false;
  return true;
}
