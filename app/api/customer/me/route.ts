import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { User } from '../../../../lib/models/user.model';
import { getCustomerSession, normalizeEmail } from '../../../../lib/customer-auth';

function toProfile(user: any) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email || null,
    phoneNumber: user.phoneNumber,
    addresses: Array.isArray(user.addresses) ? user.addresses : [],
    role: user.role,
    createdAt: user.createdAt,
  };
}

// GET /api/customer/me — профиль текущего клиента (из cookie-сессии)
export async function GET(request: NextRequest) {
  const session = getCustomerSession(request);
  if (!session) {
    return NextResponse.json({ success: false, error: 'Nicht angemeldet' }, { status: 401 });
  }
  try {
    await connectToDatabase();
    const user = await User.findById(session.userId);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Nicht gefunden' }, { status: 404 });
    }
    return NextResponse.json({ success: true, user: toProfile(user) });
  } catch (error: any) {
    console.error('customer/me GET:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// PATCH /api/customer/me — обновить имя/email/адреса (нельзя менять телефон/роль)
export async function PATCH(request: NextRequest) {
  const session = getCustomerSession(request);
  if (!session) {
    return NextResponse.json({ success: false, error: 'Nicht angemeldet' }, { status: 401 });
  }
  try {
    await connectToDatabase();
    const user = await User.findById(session.userId);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Nicht gefunden' }, { status: 404 });
    }

    const data = await request.json();

    if (typeof data.name === 'string' && data.name.trim()) {
      user.name = data.name.trim();
    }

    if (typeof data.email === 'string') {
      const email = normalizeEmail(data.email);
      if (email && email !== user.email) {
        if (!/^\S+@\S+\.\S+$/.test(email)) {
          return NextResponse.json({ success: false, error: 'Ungültige E-Mail' }, { status: 400 });
        }
        const taken = await User.findOne({ email });
        if (taken && taken._id.toString() !== user._id.toString()) {
          return NextResponse.json(
            { success: false, error: 'E-Mail ist bereits vergeben' },
            { status: 409 }
          );
        }
        user.email = email;
      }
    }

    if (Array.isArray(data.addresses)) {
      user.addresses = data.addresses;
    }

    await user.save();
    return NextResponse.json({ success: true, user: toProfile(user) });
  } catch (error: any) {
    console.error('customer/me PATCH:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
