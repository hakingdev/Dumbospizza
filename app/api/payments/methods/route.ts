import { NextRequest, NextResponse } from 'next/server';
import { resolveVisibleGroups } from '../../../../lib/payments/method-groups';
import {
  getMerchantPaymentMethodsCached,
  parseAmountParam,
} from '../../../../lib/payments/sumup-allowlist';
import { isPayPalConfigured } from '../../../../lib/payments/app-pay';

/**
 * GET /api/payments/methods?amount=
 *
 * Видимые онлайн-группы для мобильного приложения — посчитанные ЗДЕСЬ тем же
 * resolveVisibleGroups, что и чекаут сайта (allowlist SumUp × флаг PayPal),
 * чтобы приложение не дублировало правила. Публично: только id групп, без
 * сумм и ключей.
 *
 * Сбой SumUp не выключает оплату: как и на сайте, уходим в фолбэк
 * resolveVisibleGroups(null) (карточная группа остаётся), ответ всё равно 200.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  let available: string[] | null = null;
  try {
    available = await getMerchantPaymentMethodsCached({
      amount: parseAmountParam(searchParams.get('amount')),
      currency: 'EUR',
    });
  } catch (error) {
    console.error('Payment methods: SumUp allowlist unavailable:', error);
  }

  const groups = resolveVisibleGroups(available, { paypalConfigured: isPayPalConfigured() });
  return NextResponse.json(
    {
      success: true,
      groups: groups.map((g) => ({
        id: g.id,
        provider: g.provider,
        sumupIds: g.effectiveSumupIds,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
