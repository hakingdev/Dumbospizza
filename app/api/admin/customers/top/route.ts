import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { and, eq, inArray, sql, desc } from 'drizzle-orm';
import db from '../../../../../lib/db/client';
import { users, orders, loyaltyPrograms } from '../../../../../lib/db/schema';
import { authOptions, isStaff } from '../../../../../lib/auth';

// GET /api/admin/customers/top — самые активные клиенты (по числу заказов / тратам)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !isStaff(session)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    // Агрегаты по телефону: число заказов и сумма (по завершённым).
    const agg = await db
      .select({
        phoneNumber: orders.phoneNumber,
        ordersCount: sql<number>`count(*)::int`,
        totalSpent: sql<number>`coalesce(sum(case when ${orders.status} = 'completed' then ${orders.total} else 0 end), 0)`,
      })
      .from(orders)
      .groupBy(orders.phoneNumber)
      .orderBy(desc(sql`count(*)`))
      .limit(20);

    const phones = agg.map((a) => a.phoneNumber).filter(Boolean);
    if (phones.length === 0) return NextResponse.json({ success: true, customers: [] });

    const customerRows = await db
      .select({ id: users.id, name: users.name, email: users.email, phoneNumber: users.phoneNumber })
      .from(users)
      .where(and(eq(users.role, 'customer'), inArray(users.phoneNumber, phones)));
    const userByPhone = new Map(customerRows.map((u) => [u.phoneNumber, u]));

    const ids = customerRows.map((u) => u.id);
    const balances = ids.length
      ? await db
          .select({ user: loyaltyPrograms.user, balance: loyaltyPrograms.balance })
          .from(loyaltyPrograms)
          .where(inArray(loyaltyPrograms.user, ids))
      : [];
    const balanceByUser = new Map(balances.map((b) => [b.user, Number(b.balance)]));

    const customers = agg
      .map((a) => {
        const u = userByPhone.get(a.phoneNumber);
        if (!u) return null; // только зарегистрированные клиенты
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          phoneNumber: u.phoneNumber,
          ordersCount: a.ordersCount,
          totalSpent: Number(a.totalSpent),
          points: balanceByUser.get(u.id) ?? 0,
        };
      })
      .filter(Boolean);

    return NextResponse.json({ success: true, customers });
  } catch (error: any) {
    console.error('admin/customers/top GET:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
