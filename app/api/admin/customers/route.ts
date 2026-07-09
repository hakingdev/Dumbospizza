import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { and, or, eq, ilike, inArray, ne, sql, desc } from 'drizzle-orm';
import db from '../../../../lib/db/client';
import { users, orders, loyaltyPrograms } from '../../../../lib/db/schema';
import { authOptions, isStaff } from '../../../../lib/auth';
import { PENDING_PAYMENT_STATUS } from '../../../../lib/orders/payment-draft';

// GET /api/admin/customers — список клиентов с числом заказов и балансом баллов
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !isStaff(session)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const q = request.nextUrl.searchParams.get('q')?.trim();
    const where = q
      ? and(
          eq(users.role, 'customer'),
          or(
            ilike(users.name, `%${q}%`),
            ilike(users.email, `%${q}%`),
            ilike(users.phoneNumber, `%${q}%`)
          )
        )
      : eq(users.role, 'customer');

    const customerRows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        phoneNumber: users.phoneNumber,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(200);

    const ids = customerRows.map((c) => c.id);
    const phones = customerRows.map((c) => c.phoneNumber);

    // Баланс баллов по пользователям.
    const balances = ids.length
      ? await db
          .select({ user: loyaltyPrograms.user, balance: loyaltyPrograms.balance })
          .from(loyaltyPrograms)
          .where(inArray(loyaltyPrograms.user, ids))
      : [];
    const balanceByUser = new Map(balances.map((b) => [b.user, Number(b.balance)]));

    // Число заказов по номеру телефона (без драфтов незавершённой онлайн-оплаты).
    const counts = phones.length
      ? await db
          .select({
            phoneNumber: orders.phoneNumber,
            count: sql<number>`count(*)::int`,
          })
          .from(orders)
          .where(
            and(inArray(orders.phoneNumber, phones), ne(orders.status, PENDING_PAYMENT_STATUS))
          )
          .groupBy(orders.phoneNumber)
      : [];
    const countByPhone = new Map(counts.map((c) => [c.phoneNumber, c.count]));

    const customers = customerRows.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phoneNumber: c.phoneNumber,
      createdAt: c.createdAt,
      points: balanceByUser.get(c.id) ?? 0,
      ordersCount: countByPhone.get(c.phoneNumber) ?? 0,
    }));

    return NextResponse.json({ success: true, customers });
  } catch (error: any) {
    console.error('admin/customers GET:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
