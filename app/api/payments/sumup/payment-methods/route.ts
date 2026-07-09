import { NextRequest, NextResponse } from 'next/server';
import { listMerchantPaymentMethods } from '../../../../../lib/sumup';

/**
 * GET /api/payments/sumup/payment-methods?amount=&currency=
 *
 * Прокси merchant-level allowlist'а SumUp для чекаута: по нему решается,
 * какие группы способов оплаты показывать (пустая группа не рендерится) и
 * какие id уходят в onPaymentMethodsLoad. Секретный ключ остаётся на сервере.
 *
 * Кэш в памяти ~5 минут: список меняется только настройками мерчант-аккаунта,
 * а страница чекаута дёргает эндпоинт при каждом входе на шаг оплаты.
 * При сбое SumUp — { success:false }: клиент уходит в фолбэк
 * (resolveVisibleGroups(null)), оплата картой не выключается.
 */
const CACHE_TTL_MS = 5 * 60_000;
let cache: { key: string; at: number; methods: string[] } | null = null;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const amountRaw = searchParams.get('amount');
  const amount = amountRaw != null && amountRaw !== '' ? Number(amountRaw) : undefined;
  const currency = searchParams.get('currency') || 'EUR';
  const key = `${Number.isFinite(amount) ? amount : ''}:${currency}`;

  if (cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json({ success: true, methods: cache.methods });
  }

  try {
    const methods = await listMerchantPaymentMethods({
      amount: Number.isFinite(amount) ? amount : undefined,
      currency,
    });
    cache = { key, at: Date.now(), methods };
    return NextResponse.json({ success: true, methods });
  } catch (error) {
    console.error('SumUp list payment methods error:', error);
    return NextResponse.json({ success: false, methods: [] }, { status: 502 });
  }
}
