import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../lib/models';
import { authorizePosDevice } from '../../../../../lib/pos/auth';
import { getPosPrintSettings } from '../../../../../lib/pos/settings';

export const dynamic = 'force-dynamic';

/**
 * GET /api/pos/v1/config
 *
 * Настройки печати для прибора: ширина, начертание, протяжка, интервал опроса.
 * Прибор запрашивает их при старте и периодически, поэтому правка в админке
 * доезжает до кухни сама, без переустановки приложения и без визита на место.
 *
 * Шапку и подвал прибор НЕ получает: он не строит чек, а проигрывает готовые
 * операции. Шапка уже вшита в них на сервере.
 */
export async function GET(request: NextRequest) {
  const auth = authorizePosDevice(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const s = await getPosPrintSettings();

    return NextResponse.json({
      success: true,
      config: {
        enabled: s.enabled,
        pollMs: s.pollMs,
        render: {
          width: s.width,
          boldBody: s.boldBody,
          bigAccents: s.bigAccents,
          feedLines: s.feedLines,
        },
        copies: s.copies,
      },
    });
  } catch (error: any) {
    console.error('[pos] config error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
