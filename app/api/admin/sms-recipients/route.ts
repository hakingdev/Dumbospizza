import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { connectToDatabase } from '../../../../lib/models';
import { Order } from '../../../../lib/models/order.model';
import { authOptions, isStaff } from '../../../../lib/auth';
import { parsePhoneRecipients } from '../../../../lib/sms/phone';

/**
 * GET — список телефонов клиентов, давших согласие на SMS-рассылку
 * (smsMarketingConsent = true). Только для staff. Номера нормализованы в E.164
 * (+49…) и дедуплицированы — готовы к копированию в SMS-рассылку.
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

    return NextResponse.json({
      success: true,
      total: parsed.recipients.length,
      recipients: parsed.recipients,
      invalidCount: parsed.invalidEntries.length,
      duplicateCount: parsed.duplicateCount,
    });
  } catch (error) {
    console.error('GET /api/admin/sms-recipients', error);
    const message = error instanceof Error ? error.message : 'Failed to load SMS recipients';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
