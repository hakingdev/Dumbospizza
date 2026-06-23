import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../lib/models';
import { User } from '../../../../../lib/models/user.model';
import {
  setCustomerCookie,
  verifyPassword,
  normalizeEmail,
} from '../../../../../lib/customer-auth';

// POST /api/customer/auth/login — вход клиента (email + пароль)
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const data = await request.json();

    const email = normalizeEmail(data.email);
    const password = String(data.password || '');

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'E-Mail und Passwort erforderlich' },
        { status: 400 }
      );
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user || !user.password || !(await verifyPassword(password, user.password))) {
      // Не раскрываем, что именно не так (email vs пароль).
      return NextResponse.json(
        { success: false, error: 'E-Mail oder Passwort ist falsch' },
        { status: 401 }
      );
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
    console.error('Customer login error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
