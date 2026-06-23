import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { User } from '../../../../lib/models/user.model';
import { getCustomerSession } from '../../../../lib/customer-auth';
import { getLoyaltySummary, getTransactions } from '../../../../lib/loyalty/service';
import { getLoyaltyRules } from '../../../../lib/loyalty/config';

// GET /api/customer/loyalty — баланс, уровень, история, правила (только свои)
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

    const [summary, transactions, rules] = await Promise.all([
      getLoyaltySummary(session.userId, user.phoneNumber),
      getTransactions(session.userId, 50),
      getLoyaltyRules(),
    ]);

    return NextResponse.json({
      success: true,
      loyalty: {
        ...summary,
        transactions: transactions.map((t: any) => ({
          id: t.id,
          type: t.type,
          amount: t.amount,
          delta: t.delta,
          balanceAfter: t.balanceAfter,
          description: t.description,
          expiresAt: t.expiresAt,
          createdAt: t.createdAt,
        })),
      },
      // Публичная часть правил — для блока «Правила программы».
      rules: {
        earnPercentByTier: rules.earnPercentByTier,
        tierThresholds: rules.tierThresholds,
        redeemMaxShare: rules.redeemMaxShare,
        minOrderToRedeem: rules.minOrderToRedeem,
        pointValueEuro: rules.pointValueEuro,
        expiryMonths: rules.expiryMonths,
      },
    });
  } catch (error: any) {
    console.error('customer/loyalty GET:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
