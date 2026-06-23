import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { connectToDatabase } from '../../../../../lib/models';
import { User } from '../../../../../lib/models/user.model';
import { authOptions, isStaff } from '../../../../../lib/auth';
import {
  getLoyaltySummary,
  getTransactions,
  adjustPoints,
} from '../../../../../lib/loyalty/service';

interface Params {
  params: { id: string };
}

// GET /api/admin/customers/[id] — карточка клиента: профиль, баллы, история
export async function GET(_request: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session || !isStaff(session)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    await connectToDatabase();
    const user = await User.findById(params.id);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Nicht gefunden' }, { status: 404 });
    }

    const [summary, transactions] = await Promise.all([
      getLoyaltySummary(params.id, user.phoneNumber),
      getTransactions(params.id, 100),
    ]);

    return NextResponse.json({
      success: true,
      customer: {
        id: user._id.toString(),
        name: user.name,
        email: user.email || null,
        phoneNumber: user.phoneNumber,
        createdAt: user.createdAt,
      },
      loyalty: summary,
      transactions,
    });
  } catch (error: any) {
    console.error('admin/customers/[id] GET:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST /api/admin/customers/[id] — ручная корректировка баллов (delta ±)
export async function POST(request: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session || !isStaff(session)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    await connectToDatabase();
    const user = await User.findById(params.id);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Nicht gefunden' }, { status: 404 });
    }

    const body = await request.json();
    const delta = Number(body.delta);
    if (!delta || Number.isNaN(delta)) {
      return NextResponse.json(
        { success: false, error: 'delta (≠0) erforderlich' },
        { status: 400 }
      );
    }
    const adminName =
      (session.user as { name?: string; email?: string })?.name ||
      (session.user as { email?: string })?.email ||
      'admin';
    const description = String(body.description || '').trim() || `Manuell (${adminName})`;

    const result = await adjustPoints(params.id, delta, description, user.phoneNumber);

    return NextResponse.json({ success: true, balanceAfter: result.balanceAfter });
  } catch (error: any) {
    console.error('admin/customers/[id] POST:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
