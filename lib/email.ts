/**
 * SMTP email (promotion campaigns, transactional).
 * Env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE=true
 */

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Доп. SMTP-заголовки, напр. List-Unsubscribe для one-click отписки. */
  headers?: Record<string, string>;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  if (!isEmailConfigured()) {
    throw new Error('SMTP not configured (SMTP_HOST, SMTP_FROM required)');
  }

  const nodemailer = require('nodemailer') as typeof import('nodemailer');

  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure =
    process.env.SMTP_SECURE === 'true' || String(process.env.SMTP_PORT) === '465';

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text || options.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    headers: options.headers,
  });
}
