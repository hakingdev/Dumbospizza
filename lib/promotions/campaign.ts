import type { PromotionDocument } from '../models/promotion.model';
import { Order } from '../models/order.model';
import { PushDevice } from '../models/push-device.model';
import { PromotionCampaignLog } from '../models/promotion-campaign-log.model';
import { Promotion } from '../models/promotion.model';
import { sendEmail, isEmailConfigured } from '../email';
import { sendFcmToTokens, isPushConfigured } from '../push-notifications';
import { formatHappyHourLabel } from './schedule';
import { parseEmailRecipients } from './email-recipients';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || 'https://dumbospizza.de';

/** Send mass email in chunks so a large list never becomes one huge request. */
const EMAIL_BATCH_SIZE = 50;
/** Small pause between batches to ease SMTP rate limits. */
const EMAIL_BATCH_DELAY_MS = 250;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface CampaignEmailFailure {
  email: string;
  error: string;
}

export async function getCampaignPreview(promotionId: string) {
  const emails = await getPromotionEmailRecipients();
  const pushTokens = await PushDevice.find({ active: true }).select('token platform').lean();
  const logs = await PromotionCampaignLog.find({ promotionId })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  return {
    emailRecipients: emails.length,
    pushDevices: pushTokens.length,
    emailConfigured: isEmailConfigured(),
    pushConfigured: isPushConfigured(),
    logs: logs.map((l) => ({
      id: String(l._id),
      channel: l.channel,
      triggeredBy: l.triggeredBy,
      recipientCount: l.recipientCount,
      successCount: l.successCount,
      failureCount: l.failureCount,
      subject: l.subject,
      error: l.error,
      createdAt: l.createdAt,
    })),
  };
}

async function getPromotionEmailRecipients(): Promise<string[]> {
  const rows = await Order.distinct('email', {
    email: { $exists: true, $nin: [null, ''] },
  });
  return parseEmailRecipients(rows.map((e) => String(e))).recipients;
}

function buildEmailHtml(promo: PromotionDocument): string {
  const link = `${SITE_URL}/angebote/${promo.slug}`;
  const schedule = formatHappyHourLabel(promo);
  return `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h1 style="color:#b45309">${promo.name}</h1>
      ${promo.description ? `<p>${promo.description}</p>` : ''}
      ${schedule ? `<p><strong>Happy Hour:</strong> ${schedule}</p>` : ''}
      <p><a href="${link}" style="background:#b45309;color:#fff;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block">Jetzt bestellen</a></p>
      <p style="color:#888;font-size:12px">Dumbo Slice Pizza · <a href="${link}">${link}</a></p>
    </div>
  `;
}

export async function sendPromotionEmailCampaign(
  promo: PromotionDocument,
  options: { testEmail?: string; recipients?: string[]; triggeredBy?: 'manual' | 'cron' } = {}
): Promise<{
  recipientCount: number;
  successCount: number;
  failureCount: number;
  failures: CampaignEmailFailure[];
}> {
  const subject = promo.emailSubject?.trim() || `🍕 ${promo.name} — Dumbos Pizza`;
  const html = promo.emailBodyHtml?.trim() || buildEmailHtml(promo);
  const recipients = options.testEmail
    ? parseEmailRecipients([options.testEmail]).recipients
    : options.recipients
      ? parseEmailRecipients(options.recipients).recipients
      : await getPromotionEmailRecipients();

  if (recipients.length === 0 && (options.testEmail || options.recipients)) {
    throw new Error('No valid email recipients');
  }

  let successCount = 0;
  let failureCount = 0;
  const failures: CampaignEmailFailure[] = [];

  // Send in batches so a large list never hammers SMTP in one burst.
  for (let start = 0; start < recipients.length; start += EMAIL_BATCH_SIZE) {
    const batch = recipients.slice(start, start + EMAIL_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((to) => sendEmail({ to, subject, html }))
    );

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successCount++;
      } else {
        failureCount++;
        const reason =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        failures.push({ email: batch[index], error: reason });
      }
    });

    if (start + EMAIL_BATCH_SIZE < recipients.length) {
      await sleep(EMAIL_BATCH_DELAY_MS);
    }
  }

  if (!options.testEmail) {
    await Promotion.findByIdAndUpdate(promo._id, {
      emailSentAt: new Date(),
      $inc: { emailSentCount: successCount },
    });
  }

  await PromotionCampaignLog.create({
    promotionId: promo._id,
    channel: 'email',
    triggeredBy: options.triggeredBy || 'manual',
    recipientCount: recipients.length,
    successCount,
    failureCount,
    subject,
    // Summary only — keep persisted error short, never store the message body.
    error: failures.length
      ? `${failures.length} fehlgeschlagen: ${failures
          .slice(0, 5)
          .map((f) => f.email)
          .join(', ')}`
      : undefined,
  });

  return { recipientCount: recipients.length, successCount, failureCount, failures };
}

export async function sendPromotionPushCampaign(
  promo: PromotionDocument,
  options: { triggeredBy?: 'manual' | 'cron' } = {}
): Promise<{ recipientCount: number; successCount: number; failureCount: number }> {
  const devices = await PushDevice.find({ active: true }).select('token').lean();
  const tokens = devices.map((d) => d.token).filter(Boolean);
  const title = promo.pushTitle?.trim() || promo.name;
  const body = promo.pushBody?.trim() || promo.description || 'Jetzt sparen — in der App bestellen!';

  const result = await sendFcmToTokens(tokens, {
    title,
    body,
    data: {
      type: 'promotion',
      promotionId: String(promo._id),
      slug: promo.slug,
    },
  });

  if (options.triggeredBy !== 'cron' || result.success > 0) {
    await Promotion.findByIdAndUpdate(promo._id, {
      pushSentAt: new Date(),
      $inc: { pushSentCount: result.success },
    });
  }

  await PromotionCampaignLog.create({
    promotionId: promo._id,
    channel: 'push',
    triggeredBy: options.triggeredBy || 'manual',
    recipientCount: tokens.length,
    successCount: result.success,
    failureCount: result.failure,
    subject: title,
    error: result.errors.slice(0, 3).join('; ') || undefined,
  });

  return {
    recipientCount: tokens.length,
    successCount: result.success,
    failureCount: result.failure,
  };
}

/** Auto-notify at Happy Hour start (cron). */
export async function runHappyHourAutoNotifications(): Promise<{
  processed: number;
  sent: Array<{ promotionId: string; email: boolean; push: boolean }>;
}> {
  const promos = await Promotion.find({
    enabled: true,
    happyHourEnabled: true,
    autoNotifyOnStart: true,
    validFrom: { $lte: new Date() },
    validTo: { $gte: new Date() },
  }).lean();

  const sent: Array<{ promotionId: string; email: boolean; push: boolean }> = [];
  const { minutesSinceHappyHourStart } = await import('./schedule');

  for (const raw of promos) {
    const promo = raw as PromotionDocument;
    const since = minutesSinceHappyHourStart(promo);
    if (since == null || since > 10) continue;

    const last = promo.lastAutoNotifyAt ? new Date(promo.lastAutoNotifyAt) : null;
    const today = new Date();
    if (last && last.toDateString() === today.toDateString()) continue;

    let emailOk = false;
    let pushOk = false;

    if (promo.emailCampaignEnabled && isEmailConfigured()) {
      try {
        await sendPromotionEmailCampaign(promo, { triggeredBy: 'cron' });
        emailOk = true;
      } catch {
        /* logged in campaign log */
      }
    }

    if (promo.pushCampaignEnabled && isPushConfigured()) {
      try {
        await sendPromotionPushCampaign(promo, { triggeredBy: 'cron' });
        pushOk = true;
      } catch {
        /* logged */
      }
    }

    if (emailOk || pushOk) {
      await Promotion.findByIdAndUpdate(promo._id, { lastAutoNotifyAt: new Date() });
      sent.push({ promotionId: String(promo._id), email: emailOk, push: pushOk });
    }
  }

  return { processed: promos.length, sent };
}
