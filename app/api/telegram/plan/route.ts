import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { getPlanBotConfig, processPlanUpdate } from '../../../../lib/telegram-plan';

export const dynamic = 'force-dynamic';
// /plan строит AI-план (Claude, до ~25 c) синхронно до ответа Telegram;
// фото чека — скачивание + Claude Vision + оценка ETA (суммарно до ~50 с).
export const maxDuration = 60;

/**
 * Вебхук бота-диспетчера кухни (третий бот: заказы / stop / план).
 * /plan и кнопка «Пересчитать» выдают AI-план кухни (сайт + Lieferando);
 * фото чека Lieferando → распознавание и создание заказа; кнопки «+N мин» —
 * WhatsApp гостю о задержке (см. lib/telegram-plan.ts).
 * Регистрация: node scripts/telegram-webhook.mjs plan set https://www.dumbospizza.de/api/telegram/plan
 */
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const cfg = await getPlanBotConfig();

    if (!cfg.webhookSecret) {
      return NextResponse.json(
        { success: false, error: 'Plan-bot webhook secret is not configured' },
        { status: 503 }
      );
    }

    const telegramToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (telegramToken !== cfg.webhookSecret) {
      console.error('[tg-plan] Invalid webhook token');
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const update = await request.json();
    await processPlanUpdate(update, cfg);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[tg-plan] Error processing webhook:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
