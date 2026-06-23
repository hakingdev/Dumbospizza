import { NextRequest, NextResponse } from 'next/server';
import { and, eq, desc, sql } from 'drizzle-orm';
import db from '../../../../lib/db/client';
import { customerNotifications } from '../../../../lib/db/schema';
import { getCustomerSession } from '../../../../lib/customer-auth';

// GET /api/customer/notifications — уведомления текущего клиента + счётчик непрочитанных
export async function GET(request: NextRequest) {
  const session = getCustomerSession(request);
  if (!session) {
    return NextResponse.json({ success: false, error: 'Nicht angemeldet' }, { status: 401 });
  }
  try {
    const countOnly = request.nextUrl.searchParams.get('countOnly') === '1';

    const unreadRows = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(customerNotifications)
      .where(
        and(eq(customerNotifications.user, session.userId), eq(customerNotifications.read, false))
      );
    const unreadCount = unreadRows[0]?.c ?? 0;

    if (countOnly) {
      return NextResponse.json({ success: true, unreadCount });
    }

    const rows = await db
      .select()
      .from(customerNotifications)
      .where(eq(customerNotifications.user, session.userId))
      .orderBy(desc(customerNotifications.createdAt))
      .limit(50);

    return NextResponse.json({
      success: true,
      unreadCount,
      notifications: rows.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        link: n.link,
        linkLabel: n.linkLabel,
        category: n.category,
        read: n.read,
        createdAt: n.createdAt,
      })),
    });
  } catch (error: any) {
    console.error('customer/notifications GET:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST /api/customer/notifications — пометить прочитанным: { id } или { all: true }
// Помечаем только строки текущего пользователя (user_id из cookie).
export async function POST(request: NextRequest) {
  const session = getCustomerSession(request);
  if (!session) {
    return NextResponse.json({ success: false, error: 'Nicht angemeldet' }, { status: 401 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const now = new Date();

    if (body.all === true) {
      await db
        .update(customerNotifications)
        .set({ read: true, readAt: now })
        .where(
          and(
            eq(customerNotifications.user, session.userId),
            eq(customerNotifications.read, false)
          )
        );
    } else if (typeof body.id === 'string' && body.id) {
      await db
        .update(customerNotifications)
        .set({ read: true, readAt: now })
        .where(
          and(
            eq(customerNotifications.id, body.id),
            eq(customerNotifications.user, session.userId)
          )
        );
    } else {
      return NextResponse.json(
        { success: false, error: 'id oder all erforderlich' },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('customer/notifications POST:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
