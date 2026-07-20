import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../lib/models';
import { User } from '../../../../../lib/models/user.model';
import { isEmailConfigured, sendEmail } from '../../../../../lib/email';
import { buildPasswordResetEmail } from '../../../../../lib/email/password-reset-email';
import { SITE_URL } from '../../../../../lib/site-url';
import {
  RESET_TOKEN_TTL_MINUTES,
  generateResetToken,
  hashResetToken,
  normalizeEmail,
  resetTokenExpiry,
} from '../../../../../lib/customer-auth';
import { getClientIp, logSecurityEvent, rateLimit } from '../../../../../lib/security/rate-limit';

/**
 * POST /api/customer/auth/forgot-password — запрос ссылки восстановления.
 *
 * Ответ ВСЕГДА одинаковый (success + нейтральный текст), есть такой email или
 * нет. Иначе эндпоинт превращается в проверку «зарегистрирован ли этот адрес» —
 * готовый список клиентов для спамера.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  // Два независимых окна: по IP (массовый перебор) и по адресу (закидывание
  // почтового ящика одного человека письмами).
  const byIp = rateLimit(`forgot-pw:ip:${ip}`, 5, 15 * 60 * 1000);
  if (!byIp.allowed) {
    logSecurityEvent('forgot_password_rate_limited', { ip });
    return NextResponse.json(
      { success: false, error: 'Zu viele Anfragen. Bitte später erneut versuchen.' },
      { status: 429, headers: { 'Retry-After': String(byIp.retryAfterSeconds) } }
    );
  }

  try {
    const data = await request.json().catch(() => ({}));
    const email = normalizeEmail(data.email);

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ success: false, error: 'Ungültige E-Mail' }, { status: 400 });
    }

    const byEmail = rateLimit(`forgot-pw:email:${email}`, 3, 15 * 60 * 1000);
    if (!byEmail.allowed) {
      logSecurityEvent('forgot_password_rate_limited', { ip, scope: 'email' });
      return NextResponse.json(
        { success: false, error: 'Zu viele Anfragen. Bitte später erneut versuchen.' },
        { status: 429, headers: { 'Retry-After': String(byEmail.retryAfterSeconds) } }
      );
    }

    await connectToDatabase();
    const user = await User.findOne({ email });

    if (user) {
      const token = generateResetToken();
      user.passwordResetToken = hashResetToken(token);
      user.passwordResetExpires = resetTokenExpiry();
      await user.save();

      const resetUrl = `${SITE_URL}/account/reset-password?token=${encodeURIComponent(token)}`;

      if (isEmailConfigured()) {
        const mail = buildPasswordResetEmail({
          name: user.name,
          resetUrl,
          ttlMinutes: RESET_TOKEN_TTL_MINUTES,
        });
        try {
          await sendEmail({ to: email, ...mail });
        } catch (err) {
          // Клиенту всё равно отвечаем нейтрально — но в логах это должно быть
          // видно, иначе «письма не приходят» превратится в загадку.
          console.error('forgot-password sendEmail failed:', err);
        }
      } else if (process.env.NODE_ENV !== 'production') {
        // Локально SMTP обычно не настроен — печатаем ссылку, чтобы флоу
        // можно было пройти целиком.
        console.log(`[dev] Passwort-Reset-Link für ${email}: ${resetUrl}`);
      } else {
        console.error('forgot-password: SMTP не настроен, письмо не отправлено');
      }
    }

    return NextResponse.json({
      success: true,
      message:
        'Falls ein Konto mit dieser E-Mail existiert, haben wir einen Link zum Zurücksetzen gesendet.',
    });
  } catch (error: any) {
    console.error('forgot-password error:', error);
    return NextResponse.json({ success: false, error: 'Serverfehler' }, { status: 500 });
  }
}
