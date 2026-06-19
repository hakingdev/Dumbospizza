import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { connectToDatabase } from '../../../../../lib/models';
import { Promotion } from '../../../../../lib/models/promotion.model';
import { authOptions, isStaff } from '../../../../../lib/auth';
import {
  getCampaignPreview,
  sendPromotionEmailCampaign,
  sendPromotionPushCampaign,
} from '../../../../../lib/promotions/campaign';
import { isEmailConfigured } from '../../../../../lib/email';
import { isPushConfigured } from '../../../../../lib/push-notifications';

type RouteParams = { params: { id: string } };

/** GET — preview recipients + logs. POST — send email/push campaign. */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session || !isStaff(session)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const promo = await Promotion.findById(params.id);
    if (!promo) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    const preview = await getCampaignPreview(params.id);
    return NextResponse.json({ success: true, preview, promotion: { name: promo.name } });
  } catch (error) {
    console.error('GET /api/promotions/[id]/campaign', error);
    const message = error instanceof Error ? error.message : 'Failed to load campaign';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session || !isStaff(session)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const promo = await Promotion.findById(params.id);
    if (!promo) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const body = await request.json();
    const channel = body.channel as 'email' | 'push' | 'both';
    const testEmail = typeof body.testEmail === 'string' ? body.testEmail.trim() : undefined;

    if (!channel || !['email', 'push', 'both'].includes(channel)) {
      return NextResponse.json({ success: false, error: 'channel must be email, push or both' }, { status: 400 });
    }

    const results: Record<string, unknown> = {};

    if (channel === 'email' || channel === 'both') {
      if (!isEmailConfigured()) {
        return NextResponse.json(
          { success: false, error: 'SMTP not configured (SMTP_HOST, SMTP_FROM)' },
          { status: 503 }
        );
      }
      results.email = await sendPromotionEmailCampaign(promo, { testEmail });
    }

    if (channel === 'push' || channel === 'both') {
      if (testEmail) {
        return NextResponse.json(
          { success: false, error: 'Test send only supported for email' },
          { status: 400 }
        );
      }
      if (!isPushConfigured()) {
        return NextResponse.json(
          { success: false, error: 'FCM not configured (FCM_SERVER_KEY)' },
          { status: 503 }
        );
      }
      results.push = await sendPromotionPushCampaign(promo);
    }

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    console.error('POST /api/promotions/[id]/campaign', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Campaign send failed' },
      { status: 500 }
    );
  }
}
