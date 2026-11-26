import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isStaff } from '../../../../../lib/auth';
import { campaignData, parseCampaignInput } from '../../../../../lib/push/validate';
import { isExpoPushToken } from '../../../../../lib/push/expo';
import { testSend } from '../../../../../lib/push/service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/push/test — тест-отправка черновика из композера на один
 * Expo-токен или на устройства одного номера телефона. В историю не пишется.
 * Body: { token? | phoneNumber?, title, body, imageUrl?, kind?, url?, promoCode? }
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isStaff(session)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = parseCampaignInput({ ...(body || {}), scheduledAt: null });
  if (!parsed.ok) {
    return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  }
  const rawToken = typeof body?.token === 'string' ? body.token.trim() : '';
  const phoneNumber = typeof body?.phoneNumber === 'string' ? body.phoneNumber.trim() : '';
  if (rawToken && !isExpoPushToken(rawToken)) {
    return NextResponse.json({ success: false, error: 'Это не Expo push-токен' }, { status: 400 });
  }
  if (!rawToken && !phoneNumber) {
    return NextResponse.json({ success: false, error: 'Укажите токен или телефон' }, { status: 400 });
  }
  try {
    const { results, deviceCount } = await testSend(
      { token: rawToken || null, phoneNumber: phoneNumber || null },
      {
        title: parsed.value.title,
        body: parsed.value.body,
        imageUrl: parsed.value.imageUrl,
        data: campaignData(parsed.value, 'test'),
      }
    );
    if (!deviceCount) {
      return NextResponse.json(
        { success: false, error: 'Для этого номера нет активных устройств с приложением' },
        { status: 404 }
      );
    }
    const accepted = results.filter((r) => r.ok).length;
    return NextResponse.json({
      success: true,
      deviceCount,
      accepted,
      errors: results.filter((r) => !r.ok).map((r) => r.error),
    });
  } catch (error: any) {
    console.error('POST /api/admin/push/test', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
