import { NextRequest, NextResponse } from 'next/server';
import { verifyUnsubscribeToken } from '../../../../lib/email/unsubscribe';
import { addUnsubscribe } from '../../../../lib/email/suppression';
import { SITE_URL } from '../../../../lib/site-url';

export const dynamic = 'force-dynamic';

function page(title: string, message: string, ok: boolean): Response {
  const color = ok ? '#15803d' : '#b91c1c';
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#fff7ed;margin:0;padding:40px 16px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #fde3c4;border-radius:16px;padding:32px;text-align:center">
    <h1 style="color:${color};font-size:22px;margin:0 0 12px">${title}</h1>
    <p style="color:#4b3b2b;font-size:15px;line-height:1.5;margin:0 0 24px">${message}</p>
    <a href="${SITE_URL}" style="background:#b45309;color:#fff;padding:12px 24px;text-decoration:none;border-radius:10px;display:inline-block;font-weight:700">Zur Startseite</a>
  </div>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function unsubscribe(token: string | null, source: string): Promise<boolean> {
  if (!token) return false;
  const email = verifyUnsubscribeToken(token);
  if (!email) return false;
  await addUnsubscribe(email, source);
  return true;
}

/** Клик по ссылке отписки из письма. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  try {
    const ok = await unsubscribe(token, 'campaign-link');
    return ok
      ? page('Abgemeldet ✓', 'Sie wurden erfolgreich abgemeldet und erhalten keine Werbe-E-Mails mehr von Dumbos Pizza.', true)
      : page('Link ungültig', 'Dieser Abmelde-Link ist ungültig oder abgelaufen. Bitte versuchen Sie es über den Link in der aktuellsten E-Mail.', false);
  } catch (error) {
    console.error('GET /api/email/unsubscribe', error);
    return page('Fehler', 'Die Abmeldung konnte nicht verarbeitet werden. Bitte später erneut versuchen.', false);
  }
}

/** One-Click-Unsubscribe (RFC 8058) — vom Mail-Client ausgelöst. */
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  try {
    const ok = await unsubscribe(token, 'one-click');
    return NextResponse.json({ success: ok }, { status: ok ? 200 : 400 });
  } catch (error) {
    console.error('POST /api/email/unsubscribe', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
