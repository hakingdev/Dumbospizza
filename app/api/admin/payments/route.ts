import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isStaff } from '../../../../lib/auth';
import { getPayPalStore } from '../../../../lib/paypal/store';

/**
 * GET /api/admin/payments?orderId=… — платежи заказа с возвратами и остатком.
 * Данные для панели возврата в админке заказов (просмотр — staff, сам возврат
 * в POST /api/admin/payments/{id}/refund требует роль admin).
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !isStaff(session)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const orderId = request.nextUrl.searchParams.get('orderId');
  if (!orderId) {
    return NextResponse.json({ success: false, error: 'orderId is required' }, { status: 400 });
  }

  try {
    const store = getPayPalStore();
    const payments = await store.listPaymentsByOrder(orderId);

    const result = await Promise.all(
      payments.map(async (p) => {
        const refunds = await store.listRefundsByPayment(p.id);
        const activeMinor = await store.sumRefundsMinor(p.id, ['pending', 'completed']);
        return {
          id: p.id,
          provider: p.provider,
          status: p.status,
          amountMinor: p.amountMinor,
          currency: p.currency,
          providerOrderId: p.providerOrderId,
          providerCaptureId: p.providerCaptureId,
          createdAt: p.createdAt,
          remainingMinor: Math.max(0, p.amountMinor - activeMinor),
          refunds: refunds.map((r) => ({
            id: r.id,
            status: r.status,
            amountMinor: r.amountMinor,
            reason: r.reason,
            createdBy: r.createdBy,
            createdAt: r.createdAt,
          })),
        };
      })
    );

    return NextResponse.json({ success: true, payments: result });
  } catch (error) {
    console.error('Admin payments error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load payments' },
      { status: 500 }
    );
  }
}
