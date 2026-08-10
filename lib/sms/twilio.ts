/**
 * Отправка SMS через Twilio Messages API (промо-Rundsendung из админки).
 *
 * Absender = Alphanumeric Sender ID из `TWILIO_SMS_FROM` (напр. "DumboPizza",
 * макс. 11 знаков A–Z/a–z/0–9/пробел) — в Германии работает без регистрации.
 * На такой Absender нельзя ответить (STOP не существует), поэтому Werbe-SMS
 * обязана содержать Abmelde-Link — см. composeSmsText в lib/sms/segments.ts.
 *
 * Auth — та же пара, что у WhatsApp-уведомлений в lib/whatsapp.ts:
 * API Key (SK…/secret) с приоритетом, иначе Account SID + Auth Token.
 */

export interface TwilioSmsConfig {
  accountSid: string;
  authUser: string;
  authPass: string;
  from: string;
}

export function getTwilioSmsConfig(): TwilioSmsConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const from = process.env.TWILIO_SMS_FROM?.trim();
  if (!accountSid || !from) return null;

  const apiKeySid = process.env.TWILIO_API_KEY_SID?.trim();
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();

  if (apiKeySid && apiKeySecret) {
    return { accountSid, authUser: apiKeySid, authPass: apiKeySecret, from };
  }
  if (authToken) {
    return { accountSid, authUser: accountSid, authPass: authToken, from };
  }
  return null;
}

export interface SmsSendResult {
  ok: boolean;
  sid?: string;
  error?: string;
}

/** Одна SMS. `to` — уже нормализованный E.164 (+49…). Не бросает исключений. */
export async function sendSms(
  config: TwilioSmsConfig,
  to: string,
  body: string
): Promise<SmsSendResult> {
  try {
    const params = new URLSearchParams({ To: to, From: config.from, Body: body });
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization:
            'Basic ' + Buffer.from(`${config.authUser}:${config.authPass}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      }
    );

    if (!res.ok) {
      let detail = '';
      try {
        const err = (await res.json()) as { code?: number; message?: string };
        detail = [err.code, err.message].filter(Boolean).join(' ');
      } catch {
        detail = await res.text().catch(() => '');
      }
      return { ok: false, error: `HTTP ${res.status}${detail ? ` — ${detail}` : ''}` };
    }

    const data = (await res.json()) as { sid?: string };
    return { ok: true, sid: data.sid || '' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
