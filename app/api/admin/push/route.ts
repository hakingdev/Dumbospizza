import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isStaff } from '../../../../lib/auth';
import { parseCampaignInput } from '../../../../lib/push/validate';
import {
  audienceStats,
  createCampaign,
  listCampaigns,
  sendCampaign,
} from '../../../../lib/push/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET /api/admin/push — история кампаний + размер аудитории. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!isStaff(session)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const [campaigns, audience] = await Promise.all([listCampaigns(50), audienceStats()]);
    return NextResponse.json({ success: true, campaigns, audience });
  } catch (error: any) {
    console.error('GET /api/admin/push', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/admin/push — создать кампанию. Без scheduledAt уходит сразу,
 * с scheduledAt — ждёт крона /api/cron/push-campaigns.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isStaff(session)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = parseCampaignInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  }
  try {
    const createdBy = (session?.user as any)?.email || (session?.user as any)?.name || null;
    let campaign = await createCampaign(parsed.value, createdBy);
    if (!parsed.value.scheduledAt) {
      campaign = (await sendCampaign(campaign.id)) || campaign;
    }
    return NextResponse.json({ success: true, campaign });
  } catch (error: any) {
    console.error('POST /api/admin/push', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
