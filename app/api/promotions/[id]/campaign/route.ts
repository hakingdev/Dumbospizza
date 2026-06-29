import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { connectToDatabase } from '../../../../../lib/models';
import { Promotion } from '../../../../../lib/models/promotion.model';
import { authOptions, isStaff } from '../../../../../lib/auth';
import {
  getCampaignPreview,
  sendPromotionEmailCampaign,
  sendPromotionPushCampaign,
  buildCampaignEmail,
} from '../../../../../lib/promotions/campaign';
import { parseEmailRecipients } from '../../../../../lib/promotions/email-recipients';
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
    // Exact subject + HTML that would be sent — drives the editable preview in the UI.
    const email = buildCampaignEmail(promo);
    return NextResponse.json({
      success: true,
      preview: { ...preview, email },
      promotion: { name: promo.name },
    });
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
    const subjectOverride = typeof body.subject === 'string' ? body.subject : undefined;
    const htmlOverride = typeof body.html === 'string' ? body.html : undefined;
    const hasManualRecipients = !testEmail && Object.prototype.hasOwnProperty.call(body, 'recipients');
    let manualRecipients: ReturnType<typeof parseEmailRecipients> | undefined;

    if (!channel || !['email', 'push', 'both'].includes(channel)) {
      return NextResponse.json({ success: false, error: 'channel must be email, push or both' }, { status: 400 });
    }

    if (hasManualRecipients && !Array.isArray(body.recipients)) {
      return NextResponse.json({ success: false, error: 'recipients must be an array' }, { status: 400 });
    }

    if (hasManualRecipients) {
      manualRecipients = parseEmailRecipients(body.recipients);
    }

    if ((channel === 'email' || channel === 'both') && manualRecipients && manualRecipients.recipients.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid email recipients' }, { status: 400 });
    }

    const results: Record<string, unknown> = {};

    if (channel === 'email' || channel === 'both') {
      if (!isEmailConfigured()) {
        return NextResponse.json(
          { success: false, error: 'SMTP not configured (SMTP_HOST, SMTP_FROM)' },
          { status: 503 }
        );
      }
      const emailResult = await sendPromotionEmailCampaign(promo, {
        testEmail,
        recipients: manualRecipients?.recipients,
        subject: subjectOverride,
        html: htmlOverride,
      });
      const { failures, ...emailSummary } = emailResult;
      results.email = {
        ...emailSummary,
        total: emailResult.recipientCount,
        sent: emailResult.successCount,
        failed: emailResult.failureCount,
        // Per-recipient failures (capped) so the admin sees which addresses bounced.
        errors: failures.slice(0, 50),
        ...(manualRecipients
          ? {
              invalidCount: manualRecipients.invalidEntries.length,
              duplicateCount: manualRecipients.duplicateCount,
              truncated: manualRecipients.truncated,
              invalidEntries: manualRecipients.invalidEntries.slice(0, 10),
            }
          : {}),
      };
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
