import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isStaff } from '../../../../lib/auth';
import { getSetting, setSetting } from '../../../../lib/settings';
import { mergeLoyaltyRules, type LoyaltyRules } from '../../../../lib/loyalty/config';

// GET /api/admin/loyalty-rules — текущие правила (с дефолтами)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !isStaff(session)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const stored = await getSetting<Partial<LoyaltyRules>>('loyaltyRules');
  return NextResponse.json({ success: true, rules: mergeLoyaltyRules(stored) });
}

// PUT /api/admin/loyalty-rules — сохранить правила (мерж с дефолтами → полный объект)
export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !isStaff(session)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const merged = mergeLoyaltyRules(body);

    // Базовая валидация диапазонов.
    if (
      merged.redeemMaxShare < 0 ||
      merged.redeemMaxShare > 1 ||
      merged.minOrderToRedeem < 0 ||
      merged.expiryMonths <= 0 ||
      merged.pointValueEuro <= 0 ||
      Object.values(merged.earnPercentByTier).some((v) => v < 0 || v > 1)
    ) {
      return NextResponse.json(
        { success: false, error: 'Werte außerhalb des gültigen Bereichs' },
        { status: 400 }
      );
    }

    await setSetting('loyaltyRules', merged);
    return NextResponse.json({ success: true, rules: merged });
  } catch (error: any) {
    console.error('admin/loyalty-rules PUT:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
