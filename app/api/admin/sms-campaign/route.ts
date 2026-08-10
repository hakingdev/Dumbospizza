import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { connectToDatabase } from '../../../../lib/models';
import { Order } from '../../../../lib/models/order.model';
import { authOptions, isStaff } from '../../../../lib/auth';
import { parsePhoneRecipients, normalizeGermanPhone } from '../../../../lib/sms/phone';
import { getTwilioSmsConfig, sendSms } from '../../../../lib/sms/twilio';
import { analyzeSmsText, composeSmsText } from '../../../../lib/sms/segments';
import { getSmsUnsubscribeSet } from '../../../../lib/sms/suppression';

export const dynamic = 'force-dynamic';
// Вся Rundsendung уходит в одном запросе (батчи по 10 с паузой) — как и
// email-кампания; 60s хватает на ~500 номеров.
export const maxDuration = 60;

const MAX_RECIPIENTS = 500;
const MAX_MESSAGE_LENGTH = 800;
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 300;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * POST — SMS-Rundsendung (Werbung) через Twilio, только для staff.
 * Body: { message: string; testTo?: string; recipientsText?: string }
 * Без recipientsText получатели = телефоны из заказов с smsMarketingConsent,
 * в обоих случаях минус Abmelde-Liste. testTo — одиночная Test-SMS.
 * Abmelde-Hinweis дописывается сервером (composeSmsText) — UI его только показывает.
 */
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session || !isStaff(session)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const config = getTwilioSmsConfig();
    if (!config) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Twilio SMS nicht konfiguriert — TWILIO_SMS_FROM (Absender, max. 11 Zeichen) und TWILIO_ACCOUNT_SID + Auth in den Umgebungsvariablen setzen.',
        },
        { status: 503 }
      );
    }

    const body = await request.json();
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      return NextResponse.json({ success: false, error: 'Nachricht fehlt' }, { status: 400 });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { success: false, error: `Nachricht länger als ${MAX_MESSAGE_LENGTH} Zeichen` },
        { status: 400 }
      );
    }

    const finalText = composeSmsText(message);
    const info = analyzeSmsText(finalText);

    // Одиночная Test-SMS — без списков и отчёта.
    const testTo = typeof body.testTo === 'string' ? body.testTo.trim() : '';
    if (testTo) {
      const phone = normalizeGermanPhone(testTo);
      if (!phone) {
        return NextResponse.json(
          { success: false, error: 'Test-Nummer ungültig' },
          { status: 400 }
        );
      }
      const result = await sendSms(config, phone, finalText);
      if (!result.ok) {
        return NextResponse.json(
          {
            success: false,
            test: true,
            to: phone,
            segments: info.segments,
            encoding: info.encoding,
            error: result.error || 'Unbekannter Fehler',
          },
          { status: 502 }
        );
      }
      return NextResponse.json({
        success: true,
        test: true,
        to: phone,
        segments: info.segments,
        encoding: info.encoding,
      });
    }

    const recipientsText = typeof body.recipientsText === 'string' ? body.recipientsText : '';
    let parsed;
    if (recipientsText.trim()) {
      parsed = parsePhoneRecipients(recipientsText);
    } else {
      const rawPhones: unknown[] = await Order.distinct('phoneNumber', {
        smsMarketingConsent: true,
        phoneNumber: { $nin: [null, ''] },
      });
      parsed = parsePhoneRecipients(rawPhones.map((p) => String(p)));
    }

    const suppressed = await getSmsUnsubscribeSet();
    const recipients = parsed.recipients.filter((p) => !suppressed.has(p));
    const optOutSkipped = parsed.recipients.length - recipients.length;

    if (recipients.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Keine Empfänger (nach Abzug der Abmeldungen)' },
        { status: 400 }
      );
    }
    if (recipients.length > MAX_RECIPIENTS) {
      return NextResponse.json(
        {
          success: false,
          error: `Mehr als ${MAX_RECIPIENTS} Empfänger — Liste bitte aufteilen`,
        },
        { status: 400 }
      );
    }

    let sent = 0;
    const failures: Array<{ to: string; error: string }> = [];
    for (let start = 0; start < recipients.length; start += BATCH_SIZE) {
      const batch = recipients.slice(start, start + BATCH_SIZE);
      const results = await Promise.all(batch.map((to) => sendSms(config, to, finalText)));
      results.forEach((r, i) => {
        if (r.ok) sent += 1;
        else failures.push({ to: batch[i], error: r.error || 'Unbekannter Fehler' });
      });
      if (start + BATCH_SIZE < recipients.length) await sleep(BATCH_DELAY_MS);
    }

    console.info(
      '[sms-campaign]',
      JSON.stringify({
        total: recipients.length,
        sent,
        failed: failures.length,
        optOutSkipped,
        segments: info.segments,
        encoding: info.encoding,
        by: session.user?.email || session.user?.name || 'staff',
      })
    );

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent,
      failed: failures.length,
      failures: failures.slice(0, 50),
      optOutSkipped,
      invalidCount: parsed.invalidEntries.length,
      duplicateCount: parsed.duplicateCount,
      segments: info.segments,
      encoding: info.encoding,
      from: config.from,
    });
  } catch (error) {
    console.error('POST /api/admin/sms-campaign', error);
    const message = error instanceof Error ? error.message : 'SMS-Versand fehlgeschlagen';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
