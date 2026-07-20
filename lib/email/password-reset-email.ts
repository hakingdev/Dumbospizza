/**
 * Письмо «Passwort zurücksetzen».
 *
 * Вёрстка намеренно как в кампаниях (lib/promotions/campaign.ts): инлайн-стили,
 * один акцентный цвет, max-width 560px — почтовики не понимают <style> и медиа-
 * запросы. Текстовая версия отдаётся явно, чтобы письмо не улетало в спам из-за
 * пустого text/plain.
 */
import { SELLER } from '../company';

export interface PasswordResetEmail {
  subject: string;
  html: string;
  text: string;
}

const ACCENT = '#b45309';

export function buildPasswordResetEmail(options: {
  name?: string | null;
  resetUrl: string;
  ttlMinutes: number;
}): PasswordResetEmail {
  const { resetUrl, ttlMinutes } = options;
  const greeting = options.name ? `Hallo ${escapeHtml(options.name)},` : 'Hallo,';

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#333;line-height:1.6">
    <h1 style="color:${ACCENT};font-size:22px;margin:0 0 16px">Passwort zurücksetzen</h1>
    <p style="margin:0 0 12px">${greeting}</p>
    <p style="margin:0 0 12px">
      Sie haben angefordert, das Passwort für Ihr Konto bei ${SELLER.marketingName} zurückzusetzen.
      Klicken Sie auf den Button, um ein neues Passwort zu vergeben.
    </p>
    <p style="margin:24px 0">
      <a href="${resetUrl}" style="background:${ACCENT};color:#fff;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold">Neues Passwort festlegen</a>
    </p>
    <p style="margin:0 0 12px;color:#666;font-size:14px">
      Der Link ist ${ttlMinutes} Minuten gültig und kann nur einmal verwendet werden.
    </p>
    <p style="margin:0 0 12px;color:#666;font-size:14px">
      Falls der Button nicht funktioniert, kopieren Sie diese Adresse in Ihren Browser:<br>
      <a href="${resetUrl}" style="color:${ACCENT};word-break:break-all">${resetUrl}</a>
    </p>
    <p style="margin:24px 0 0;color:#666;font-size:14px">
      Sie haben das nicht angefordert? Dann können Sie diese E-Mail ignorieren —
      Ihr Passwort bleibt unverändert.
    </p>
    <div style="margin-top:32px;border-top:2px solid ${ACCENT};padding-top:16px;color:#9b8a78;font-size:12px">
      <div style="font-weight:700;color:${ACCENT};font-size:14px;margin-bottom:4px">${SELLER.marketingName}</div>
      <div>${SELLER.legalName} &middot; ${SELLER.street} &middot; ${SELLER.postalCode} ${SELLER.city}</div>
      <div>Tel.: ${SELLER.phone} &middot; E-Mail: ${SELLER.email}</div>
    </div>
  </div>`;

  const text = [
    greeting.replace(/<[^>]+>/g, ''),
    '',
    `Sie haben angefordert, das Passwort für Ihr Konto bei ${SELLER.marketingName} zurückzusetzen.`,
    'Öffnen Sie diesen Link, um ein neues Passwort zu vergeben:',
    resetUrl,
    '',
    `Der Link ist ${ttlMinutes} Minuten gültig und kann nur einmal verwendet werden.`,
    'Sie haben das nicht angefordert? Dann ignorieren Sie diese E-Mail.',
    '',
    `${SELLER.marketingName} · ${SELLER.street} · ${SELLER.postalCode} ${SELLER.city}`,
  ].join('\n');

  return { subject: `Passwort zurücksetzen – ${SELLER.marketingName}`, html, text };
}

/** Имя приходит из БД — экранируем, чтобы оно не ломало вёрстку письма. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
