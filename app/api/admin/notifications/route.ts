import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { desc, sql } from 'drizzle-orm';
import db from '../../../../lib/db/client';
import { customerNotifications } from '../../../../lib/db/schema';
import { genObjectId } from '../../../../lib/db/object-id';
import { authOptions, isStaff } from '../../../../lib/auth';
import { resolveRecipients, type AudienceSpec } from '../../../../lib/notifications/audience';

const VALID_CATEGORIES = ['promo', 'order', 'loyalty', 'system'];

function parseAudience(body: any): AudienceSpec | null {
  const a = body?.audience;
  if (!a || typeof a !== 'object') return null;
  switch (a.type) {
    case 'all':
      return { type: 'all' };
    case 'customer':
      return typeof a.userId === 'string' && a.userId ? { type: 'customer', userId: a.userId } : null;
    case 'customers':
      return Array.isArray(a.userIds) && a.userIds.length ? { type: 'customers', userIds: a.userIds } : null;
    case 'inactive':
      return Number(a.days) > 0 ? { type: 'inactive', days: Number(a.days) } : null;
    case 'product':
      return typeof a.productId === 'string' && a.productId
        ? { type: 'product', productId: a.productId, minCount: Number(a.minCount) || 1 }
        : null;
    default:
      return null;
  }
}

// POST /api/admin/notifications — отправить уведомление сегменту (создаёт строки)
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !isStaff(session)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const title = String(body.title || '').trim();
    const text = String(body.body || '').trim();
    const link = body.link ? String(body.link).trim() : null;
    const linkLabel = body.linkLabel ? String(body.linkLabel).trim() : null;
    const category = VALID_CATEGORIES.includes(body.category) ? body.category : 'system';

    if (!title || !text) {
      return NextResponse.json(
        { success: false, error: 'Titel und Text erforderlich' },
        { status: 400 }
      );
    }

    const audience = parseAudience(body);
    if (!audience) {
      return NextResponse.json({ success: false, error: 'Ungültige Zielgruppe' }, { status: 400 });
    }

    const recipients = await resolveRecipients(audience);
    if (recipients.length === 0) {
      return NextResponse.json({ success: true, recipientCount: 0 });
    }

    const campaignId = genObjectId();
    const audienceLabel = audience.type;
    const rows = recipients.map((r) => ({
      user: r.userId,
      title,
      body: text,
      link,
      linkLabel,
      category,
      campaignId,
      audience: audienceLabel,
    }));

    // Батч-вставка (чанками, чтобы не упереться в лимит параметров).
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.insert(customerNotifications).values(rows.slice(i, i + CHUNK));
    }

    return NextResponse.json({ success: true, recipientCount: recipients.length, campaignId });
  } catch (error: any) {
    console.error('admin/notifications POST:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// GET /api/admin/notifications — история рассылок (по campaignId)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !isStaff(session)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const rows = await db
      .select({
        campaignId: customerNotifications.campaignId,
        title: sql<string>`max(${customerNotifications.title})`,
        audience: sql<string>`max(${customerNotifications.audience})`,
        category: sql<string>`max(${customerNotifications.category})`,
        recipientCount: sql<number>`count(*)::int`,
        readCount: sql<number>`sum(case when ${customerNotifications.read} then 1 else 0 end)::int`,
        createdAt: sql<string>`max(${customerNotifications.createdAt})`,
      })
      .from(customerNotifications)
      .where(sql`${customerNotifications.campaignId} is not null`)
      .groupBy(customerNotifications.campaignId)
      .orderBy(desc(sql`max(${customerNotifications.createdAt})`))
      .limit(50);

    return NextResponse.json({ success: true, campaigns: rows });
  } catch (error: any) {
    console.error('admin/notifications GET:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
