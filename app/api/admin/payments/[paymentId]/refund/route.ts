import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isAdmin } from '../../../../../../lib/auth';
import { refundPayPalPayment } from '../../../../../../lib/paypal/service';
import { PayPalApiError } from '../../../../../../lib/paypal/client';
import { logPayPalError } from '../../../../../../lib/paypal/log';

/**
 * POST /api/admin/payments/{paymentId}/refund — только роль admin.
 * Body: { amountMinor?, reason? } — без amountMinor выполняется полный возврат
 * остатка. amountMinor больше остатка (captured − уже возвращено, включая
 * pending-возвраты) → 400. PayPal-Request-Id возврата сохраняется в БД ДО
 * вызова API — ретрай не создаёт второй возврат. Финальный статус подтверждает
 * вебхук PAYMENT.CAPTURE.REFUNDED.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { paymentId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const paymentId = params.paymentId;
  if (!paymentId) {
    return NextResponse.json({ success: false, error: 'paymentId is required' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const amountMinor = body?.amountMinor;
  if (amountMinor !== undefined && (!Number.isInteger(amountMinor) || amountMinor <= 0)) {
    return NextResponse.json(
      { success: false, error: 'amountMinor muss eine positive Ganzzahl (Cent) sein' },
      { status: 400 }
    );
  }
  const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 500) : undefined;

  const user = session.user as { email?: string | null; id?: string } | undefined;
  const createdBy = user?.email || user?.id || 'admin';

  try {
    const result = await refundPayPalPayment(paymentId, { amountMinor, reason, createdBy });

    // `=== false` вместо `!ok`: под strict:false только так сужается union
    if (result.ok === false) {
      const map = {
        payment_not_found: { status: 404, error: 'Payment not found' },
        not_refundable: {
          status: 409,
          error: 'Zahlung ist nicht erstattbar (kein abgeschlossener Capture)',
        },
        invalid_amount: { status: 400, error: 'Ungültiger Betrag' },
        exceeds_remaining: { status: 400, error: 'Betrag übersteigt den erstattbaren Rest' },
      } as const;
      const m = map[result.code];
      return NextResponse.json(
        { success: false, error: m.error, remainingMinor: result.remainingMinor },
        { status: m.status }
      );
    }

    return NextResponse.json({
      success: true,
      refund: {
        id: result.refundId,
        providerRefundId: result.providerRefundId,
        status: result.refundStatus,
        amountMinor: result.amountMinor,
      },
      paymentStatus: result.paymentStatus,
    });
  } catch (error) {
    if (error instanceof PayPalApiError) {
      logPayPalError('refund_api_error', {
        payment_id: paymentId,
        status: error.status,
        issue: error.issue,
      });
      return NextResponse.json(
        { success: false, error: 'PayPal hat den Refund abgelehnt oder ist nicht erreichbar' },
        { status: 502 }
      );
    }
    console.error('PayPal refund error:', error);
    return NextResponse.json({ success: false, error: 'Refund failed' }, { status: 500 });
  }
}
