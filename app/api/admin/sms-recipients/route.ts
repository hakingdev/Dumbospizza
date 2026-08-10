import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { connectToDatabase } from '../../../../lib/models';
import { Order } from '../../../../lib/models/order.model';
import { authOptions, isStaff } from '../../../../lib/auth';
import { parsePhoneRecipients } from '../../../../lib/sms/phone';
import { getSmsUnsubscribeSet } from '../../../../lib/sms/suppression';
import { getTwilioSmsConfig } from '../../../../lib/sms/twilio';

/**
 * GET — список телефонов клиентов, давших согласие на SMS-рассылку
 * (smsMarketingConsent = true), минус отписавшиеся через /sms-abmelden.
 * Только для staff. Номера нормализованы в E.164 (+49…) и дедуплицированы —
 * это же множество получает Rundsendung в /api/admin/sms-campaign.
 */
export async function GET(_request: NextRequest) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session || !isStaff(session)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const rawPhones: unknown[] = await Order.distinct('phoneNumber', {
      smsMarketingConsent: true,
      phoneNumber: { $nin: [null, ''] },
    });

    const parsed = parsePhoneRecipients(rawPhones.map((p) => String(p)));
    const suppressed = await getSmsUnsubscribeSet();
    const recipients = parsed.recipients.filter((p) => !suppressed.has(p));
    const config = getTwilioSmsConfig();

    return NextResponse.json({
      success: true,
      total: recipients.length,
      recipients,
      invalidCount: parsed.invalidEntries.length,
      duplicateCount: parsed.duplicateCount,
      optOutCount: parsed.recipients.length - recipients.length,
      smsConfigured: Boolean(config),
      smsFrom: config?.from ?? null,
    });
  } catch (error) {
    console.error('GET /api/admin/sms-recipients', error);
    const message = error instanceof Error ? error.message : 'Failed to load SMS recipients';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
