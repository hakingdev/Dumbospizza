import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { expireMenuStops, resetMenuStopMode } from '../../../../lib/menu-stop/service';
import { sendControlMessage } from '../../../../lib/telegram-control';

/**
 * Cron: включить обратно размеры и позиции, которые выключил Telegram-стоп-бот
 * «до конца дня» (lib/menu-stop). Срок — конец последней смены по графику
 * приёма; крон в vercel.json стоит на 03:00 UTC (04:00/05:00 по Берлину) —
 * заведомо после закрытия и до открытия, с запасом на перевод часов.
 * Те же записи снимают и сами экраны бота при открытии, так что крон —
 * страховка на ночи, когда панель никто не открывал.
 *
 * Бессрочные записи (until = null) крон НЕ трогает — их включают только
 * кнопкой; на Lieferando их заново выключает утренний крон menu-stop-reapply.
 * Заодно режим кнопок бота возвращается на «до конца дня», чтобы случайный
 * тап назавтра не выключил позицию навсегда.
 *
 * Авторизация (как у других cron-роутов):
 *   Header: Authorization: Bearer CRON_SECRET  ИЛИ  ?secret=CRON_SECRET
 *
 * Руками: curl "https://www.dumbospizza.de/api/cron/menu-stop-expire?secret=…"
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret) {
      return NextResponse.json({ success: false, error: 'CRON_SECRET not set' }, { status: 503 });
    }

    const auth = request.headers.get('authorization') || '';
    const querySecret = request.nextUrl.searchParams.get('secret');
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (bearer !== secret && querySecret !== secret) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectToDatabase();
    const expired = await expireMenuStops(new Date());
    const modeReset = await resetMenuStopMode();
    const result = { ...expired, modeReset };
    console.log('[menu-stop-expire]', result);

    // Сообщение в группу стоп-бота — best-effort, только если что-то включили.
    if (expired.sizes.length || expired.products.length) {
      const lines = ['🌅 <b>Стоп-лист бота снят</b> — включено обратно:'];
      if (expired.sizes.length) lines.push(`🍕 Размеры: ${expired.sizes.join(', ')}`);
      if (expired.products.length) lines.push(`📋 Позиции: ${expired.products.join(', ')}`);
      if (modeReset) lines.push('⏳ Режим кнопок бота снова «до конца дня».');
      await sendControlMessage(lines.join('\n'));
    }

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error('GET /api/cron/menu-stop-expire', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
