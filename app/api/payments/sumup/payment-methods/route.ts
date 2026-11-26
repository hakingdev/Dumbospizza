import { NextRequest, NextResponse } from 'next/server';
import {
  getMerchantPaymentMethodsCached,
  parseAmountParam,
} from '../../../../../lib/payments/sumup-allowlist';

/**
 * GET /api/payments/sumup/payment-methods?amount=&currency=
 *
 * Прокси merchant-level allowlist'а SumUp для чекаута: по нему решается,
 * какие группы способов оплаты показывать (пустая группа не рендерится) и
 * какие id уходят в onPaymentMethodsLoad. Секретный ключ остаётся на сервере.
 *
 * Кэш в памяти ~5 минут (lib/payments/sumup-allowlist).
 * При сбое SumUp — { success:false }: клиент уходит в фолбэк
 * (resolveVisibleGroups(null)), оплата картой не выключается.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  try {
    const methods = await getMerchantPaymentMethodsCached({
      amount: parseAmountParam(searchParams.get('amount')),
      currency: searchParams.get('currency') || 'EUR',
    });
    return NextResponse.json({ success: true, methods });
  } catch (error) {
    console.error('SumUp list payment methods error:', error);
    return NextResponse.json({ success: false, methods: [] }, { status: 502 });
  }
}
