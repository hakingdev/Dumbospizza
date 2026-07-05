import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { getControlConfig, processControlUpdate } from '../../../../lib/telegram-control';

/**
 * Вебхук СЛУЖЕБНОГО stop-бота (отдельный от бота заказов /api/telegram/webhook).
 * Кнопки «Блок 30/60 мин» / «Разблокировать» пишут в storeSettings.ordersBlockedUntil.
 * Регистрация: node scripts/telegram-webhook.mjs control set https://www.dumbospizza.de/api/telegram/control
 */
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const cfg = await getControlConfig();

    if (!cfg.webhookSecret) {
      return NextResponse.json(
        { success: false, error: 'Control webhook secret is not configured' },
        { status: 503 }
      );
    }

    const telegramToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (telegramToken !== cfg.webhookSecret) {
      console.error('[tg-control] Invalid webhook token');
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const update = await request.json();
    await processControlUpdate(update, cfg);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[tg-control] Error processing webhook:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
