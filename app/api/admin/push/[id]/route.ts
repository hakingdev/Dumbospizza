import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isStaff } from '../../../../../lib/auth';
import { cancelCampaign, sendCampaign } from '../../../../../lib/push/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/admin/push/:id { action: 'cancel' | 'send-now' }
 * Действия над запланированной кампанией.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!isStaff(session)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  try {
    if (body?.action === 'cancel') {
      const ok = await cancelCampaign(params.id);
      if (!ok) return NextResponse.json({ success: false, error: 'Кампания уже не запланирована' }, { status: 409 });
      return NextResponse.json({ success: true });
    }
    if (body?.action === 'send-now') {
      const campaign = await sendCampaign(params.id);
      if (!campaign) return NextResponse.json({ success: false, error: 'Кампания уже не запланирована' }, { status: 409 });
      return NextResponse.json({ success: true, campaign });
    }
    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    console.error('POST /api/admin/push/[id]', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
