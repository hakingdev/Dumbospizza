import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../lib/models';
import { User } from '../../../../../lib/models/user.model';
import { hashResetToken, setCustomerCookie } from '../../../../../lib/customer-auth';
import { getClientIp, logSecurityEvent, rateLimit } from '../../../../../lib/security/rate-limit';

/** Минимальная длина пароля — как в /api/customer/auth/register. */
const MIN_PASSWORD_LENGTH = 6;

/**
 * POST /api/customer/auth/reset-password — установка нового пароля по токену.
 *
 * Токен ищется по SHA-256 (в БД лежит только хеш) и обязан быть непросроченным.
 * После успеха токен гасится — ссылка одноразовая.
 *
 * ЗАМЕЧАНИЕ: сессии на других устройствах остаются валидными — JWT `dp_customer`
 * самодостаточен и не сверяется с БД. Для полноценного «разлогинить везде»
 * нужен счётчик версии сессии в users + проверка в verifyCustomerToken.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  // Токен 256-битный, перебрать его нельзя, но лимит убирает шум в логах и
  // страхует от кривого клиента, долбящего эндпоинт в цикле.
  const limit = rateLimit(`reset-pw:ip:${ip}`, 10, 15 * 60 * 1000);
  if (!limit.allowed) {
    logSecurityEvent('reset_password_rate_limited', { ip });
    return NextResponse.json(
      { success: false, error: 'Zu viele Versuche. Bitte später erneut versuchen.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  try {
    const data = await request.json().catch(() => ({}));
    const token = String(data.token || '');
    const password = String(data.password || '');

    if (!token) {
      return NextResponse.json({ success: false, error: 'Link ungültig' }, { status: 400 });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { success: false, error: `Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben` },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const user = await User.findOne({
      passwordResetToken: hashResetToken(token),
      passwordResetExpires: { $gt: new Date() },
    });

    if (!user) {
      logSecurityEvent('reset_password_invalid_token', { ip });
      return NextResponse.json(
        { success: false, error: 'Der Link ist ungültig oder abgelaufen. Bitte neu anfordern.' },
        { status: 400 }
      );
    }

    user.password = password; // хешируется в preSave модели
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await user.save();

    logSecurityEvent('reset_password_success', { ip, userId: user._id.toString() });

    // Сразу пускаем в аккаунт: пароль только что подтверждён владельцем почты.
    const response = NextResponse.json({
      success: true,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
      },
    });
    return setCustomerCookie(response, user._id.toString());
  } catch (error: any) {
    console.error('reset-password error:', error);
    return NextResponse.json({ success: false, error: 'Serverfehler' }, { status: 500 });
  }
}
