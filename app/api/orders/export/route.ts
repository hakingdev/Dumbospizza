import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { connectToDatabase } from '../../../../lib/models';
import { Order } from '../../../../lib/models/order.model';
import { visibleOrderStatusFilter } from '../../../../lib/orders/payment-draft';

export const dynamic = 'force-dynamic';

type ExportOrderRow = {
  order_number: string;
  order_id: string;
  event_name: string;
  event_time: string;
  value: number;
  currency: string;
  customer_name: string;
  phone: string;
  email: string;
  status: string;
  payment_method: string;
  delivery_type: string;
  delivery_fee: number;
  subtotal: number;
  discount_amount: number;
  loyalty_points_used: number;
  items_count: number;
};

function toIso(value: unknown): string {
  const d = value ? new Date(String(value)) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

function escapeCsvValue(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Для полей date (YYYY-MM-DD) — начало / конец календарного дня в UTC. */
function parseStartDateParam(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return new Date(s);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0));
}

function parseEndDateParam(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return new Date(s);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999));
}

function buildCsv(rows: ExportOrderRow[]): string {
  if (rows.length === 0) {
    return 'order_number,order_id,event_name,event_time,value,currency,customer_name,phone,email,status,payment_method,delivery_type,delivery_fee,subtotal,discount_amount,loyalty_points_used,items_count\n';
  }

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escapeCsvValue(row[h as keyof ExportOrderRow])).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}

export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();

    const searchParams = request.nextUrl.searchParams;
    const format = (searchParams.get('format') || 'csv').toLowerCase();
    const status = searchParams.get('status');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const query: Record<string, any> = {};
    // Драфты онлайн-оплаты (pending_payment) в экспорт не попадают.
    query.status = visibleOrderStatusFilter(status);
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = parseStartDateParam(startDate);
      if (endDate) query.createdAt.$lte = parseEndDateParam(endDate);
    }

    const orders = await Order.find(query).sort({ createdAt: -1 }).limit(5000);

    const rows: ExportOrderRow[] = orders.map((order: any) => ({
      order_number: String(order.orderNumber || ''),
      order_id: String(order._id || ''),
      event_name: 'Purchase',
      event_time: toIso(order.createdAt),
      value: Number(order.total || 0),
      currency: 'EUR',
      customer_name: String(order.customerName || ''),
      phone: String(order.phoneNumber || ''),
      email: String(order.email || ''),
      status: String(order.status || ''),
      payment_method: String(order.paymentMethod || ''),
      delivery_type: String(order.deliveryType || ''),
      delivery_fee: Number(order.deliveryFee || 0),
      subtotal: Number(order.subtotal || 0),
      discount_amount: Number(order.discount?.amount || 0),
      loyalty_points_used: Number(order.loyaltyPointsUsed || 0),
      items_count: Array.isArray(order.items) ? order.items.length : 0,
    }));

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

    if (format === 'xlsx' || format === 'xls') {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, 'Orders');
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="orders-export-${stamp}.xlsx"`,
        },
      });
    }

    const csv = buildCsv(rows);
    return new NextResponse(`\uFEFF${csv}`, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="orders-export-${stamp}.csv"`,
      },
    });
  } catch (error: any) {
    console.error('Error exporting orders:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
