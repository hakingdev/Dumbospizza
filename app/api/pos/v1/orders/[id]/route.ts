import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../../lib/models';
import { Order } from '../../../../../../lib/models/order.model';
import { authorizePos } from '../../../../../../lib/pos/auth';
import { getPosPrintSettings } from '../../../../../../lib/pos/settings';
import { orderToReceiptOrder } from '../../../../../../lib/pos/print-job';
import { posEuro, toBoardOrder } from '../../../../../../lib/pos/board';
import {
  buildKitchenReceiptOps,
  renderOpsToText,
} from '../../../../../../lib/receipt/kitchen-receipt';

export const dynamic = 'force-dynamic';

/**
 * GET /api/pos/v1/orders/[id] — заказ целиком для экрана деталей.
 *
 * Отдельно от ленты, потому что читается по одному и редко: тащить состав,
 * телефон и предпросмотр бона в каждый тик опроса — платить за них постоянно
 * ради экрана, который открывают изредка.
 *
 * Предпросмотр чека строится ЗДЕСЬ и теми же функциями, что и настоящая печать,
 * причём на ширине из настроек прибора. Собирать его на клиенте значило бы
 * держать вторую раскладку чека, которая однажды разойдётся с бумагой.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizePos(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const order: any = await Order.findById(params.id).lean();
    if (!order) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const summary = toBoardOrder(order);
    if (!summary) {
      // Драфт неоплаченного заказа кухне показывать нельзя: его ещё нет.
      return NextResponse.json({ success: false, error: 'Not visible' }, { status: 404 });
    }

    const settings = await getPosPrintSettings();
    const receipt = orderToReceiptOrder(order);
    const receiptLines = renderOpsToText(
      buildKitchenReceiptOps(receipt, { header: settings.header, footer: settings.footer }),
      settings.width
    );

    return NextResponse.json(
      {
        success: true,
        serverTimeMs: Date.now(),
        order: {
          ...summary,
          phone: String(order.phoneNumber ?? ''),
          note: String(order.notes ?? ''),
          paymentMethod: String(order.paymentMethod ?? ''),
          items: (order.items ?? []).map((item: any) => ({
            qty: Number(item.quantity) || 1,
            name: String(item.name ?? ''),
            price: posEuro((Number(item.price) || 0) * (Number(item.quantity) || 1)),
          })),
          deliveryFee: Number(order.deliveryFee) || 0,
          print: {
            status: String(order.kitchenPrintStatus ?? 'pending'),
            seq: Number(order.kitchenPrintSeq) || 0,
          },
          receiptLines,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: any) {
    console.error('[pos] order detail error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
