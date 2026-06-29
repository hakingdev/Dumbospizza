import type { PromotionDocument } from '../models/promotion.model';
import { Order } from '../models/order.model';
import { PushDevice } from '../models/push-device.model';
import { PromotionCampaignLog } from '../models/promotion-campaign-log.model';
import { Promotion } from '../models/promotion.model';
import { sendEmail, isEmailConfigured } from '../email';
import { sendFcmToTokens, isPushConfigured } from '../push-notifications';
import { formatHappyHourLabel } from './schedule';
import { parseEmailRecipients } from './email-recipients';
import { filterUnsubscribed } from '../email/suppression';
import { buildUnsubscribeUrl } from '../email/unsubscribe';
import { SELLER } from '../company';

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
  const parsed = parseEmailRecipients(rows.map((e) => String(e))).recipients;
  // Abgemeldete Adressen (Widerspruch) automatisch ausschließen.
  return filterUnsubscribed(parsed);
}

/**
 * Rechtlicher E-Mail-Footer (Impressum + Abmeldung) — in Markenfarben, Pflicht
 * in jeder Werbe-Mail (§ 5 TMG / § 7 Abs. 3 Nr. 4 UWG). Per-Empfänger Abmelde-Link.
 */
function unsubscribeFooterHtml(unsubscribeUrl: string): string {
  const link = (href: string, label: string) =>
    `<a href="${href}" style="color:#b45309;text-decoration:none">${label}</a>`;
  return `<div style="margin-top:32px;border-top:2px solid #b45309;padding-top:16px;font-family:Arial,Helvetica,sans-serif;color:#9b8a78;font-size:12px;line-height:1.6">
    <div style="font-weight:700;color:#b45309;font-size:14px;margin-bottom:4px">${SELLER.marketingName}</div>
    <div>${SELLER.legalName} &middot; ${SELLER.street} &middot; ${SELLER.postalCode} ${SELLER.city}</div>
    <div>Tel.: ${SELLER.phone} &middot; E-Mail: ${link(`mailto:${SELLER.email}`, SELLER.email)}</div>
    <div>Geschäftsführer: ${SELLER.managingDirector} &middot; ${SELLER.registerCourt} ${SELLER.registerNumber} &middot; USt-ID: ${SELLER.vatId}</div>
    <div style="margin-top:10px">
      ${link(`${SITE_URL}/impressum`, 'Impressum')} &nbsp;|&nbsp;
      ${link(`${SITE_URL}/datenschutz`, 'Datenschutz')} &nbsp;|&nbsp;
      ${link(unsubscribeUrl, 'Vom Newsletter abmelden')}
    </div>
    <div style="margin-top:8px;color:#b8a896">
      Sie erhalten diese E-Mail, weil Sie bei ${SELLER.marketingName} bestellt haben (§ 7 Abs. 3 UWG).
      Eine Abmeldung ist jederzeit kostenlos möglich.
    </div>
  </div>`;
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

/**
 * Resolve the actual subject + HTML that will be sent.
 * Priority: per-send override → saved promotion fields → auto-generated template.
 */
export function buildCampaignEmail(
  promo: PromotionDocument,
  overrides?: { subject?: string; html?: string }
): { subject: string; html: string } {
  const subject =
    overrides?.subject?.trim() || promo.emailSubject?.trim() || `🍕 ${promo.name} — Dumbos Pizza`;
  const html = overrides?.html?.trim() || promo.emailBodyHtml?.trim() || buildEmailHtml(promo);
  return { subject, html };
}

export async function sendPromotionEmailCampaign(
  promo: PromotionDocument,
  options: {
    testEmail?: string;
    recipients?: string[];
    triggeredBy?: 'manual' | 'cron';
    subject?: string;
    html?: string;
  } = {}
): Promise<{
  recipientCount: number;
  successCount: number;
  failureCount: number;
  failures: CampaignEmailFailure[];
}> {
  const { subject, html } = buildCampaignEmail(promo, {
    subject: options.subject,
    html: options.html,
  });
  const recipients = options.testEmail
    ? parseEmailRecipients([options.testEmail]).recipients
    : options.recipients
      ? // Hochgeladene Listen: Abgemeldete automatisch entfernen.
        await filterUnsubscribed(parseEmailRecipients(options.recipients).recipients)
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
      batch.map((to) => {
        // Per-Empfänger signierter Abmelde-Link + List-Unsubscribe-Header (one-click).
        const unsubscribeUrl = buildUnsubscribeUrl(SITE_URL, to);
        return sendEmail({
          to,
          subject,
          html: html + unsubscribeFooterHtml(unsubscribeUrl),
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });
      })
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
