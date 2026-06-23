import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../lib/models';
import { User } from '../../../../../lib/models/user.model';
import { createLoyaltyProgram } from '../../../../../lib/loyalty';
import {
  setCustomerCookie,
  normalizeEmail,
  normalizePhone,
} from '../../../../../lib/customer-auth';

// POST /api/customer/auth/register — регистрация клиента (email + пароль)
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const data = await request.json();

    const name = String(data.name || '').trim();
    const email = normalizeEmail(data.email);
    const password = String(data.password || '');
    const phoneNumber = normalizePhone(data.phoneNumber);

    if (!name) {
      return NextResponse.json({ success: false, error: 'Bitte Namen angeben' }, { status: 400 });
    }
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ success: false, error: 'Ungültige E-Mail' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json(
        { success: false, error: 'Passwort muss mindestens 6 Zeichen haben' },
        { status: 400 }
      );
    }
    if (!phoneNumber || phoneNumber.length < 6) {
      return NextResponse.json(
        { success: false, error: 'Bitte gültige Telefonnummer angeben' },
        { status: 400 }
      );
    }

    // Уже есть аккаунт с таким email?
    const byEmail = await User.findOne({ email }).select('+password');
    if (byEmail && byEmail.password) {
      return NextResponse.json(
        { success: false, error: 'E-Mail ist bereits registriert' },
        { status: 409 }
      );
    }

    // «Забрать» аккаунт, созданный прошлыми заказами по телефону (без пароля).
    let user = byEmail || (await User.findOne({ phoneNumber }).select('+password'));

    if (user && user.password) {
      return NextResponse.json(
        { success: false, error: 'Telefonnummer ist bereits registriert' },
        { status: 409 }
      );
    }

    if (user) {
      // claim: проставляем пароль/имя/email
      user.name = name || user.name;
      user.email = user.email || email;
      user.phoneNumber = user.phoneNumber || phoneNumber;
      user.password = password; // хешируется в preSave
      user.role = user.role || 'customer';
      await user.save();
    } else {
      user = new User({ name, email, phoneNumber, password, role: 'customer' });
      await user.save();
    }

    // Завести программу лояльности (идемпотентно).
    try {
      await createLoyaltyProgram(user._id.toString(), phoneNumber);
    } catch (e) {
      console.error('createLoyaltyProgram on register:', e);
    }

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
    console.error('Customer register error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
