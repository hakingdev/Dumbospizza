import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import {
  claimLieferandoCommand,
  reportLieferandoResult,
  type LieferandoAction,
} from '../../../../lib/lieferando-makilove';
import { sendControlMessage } from '../../../../lib/telegram-control';

/**
 * Обмен с агентом Lieferando на кассовом ПК (scripts/lieferando/agent.mjs).
 *
 * GET  — поллинг: агент забирает команду off/on (и heartbeat'ится);
 * POST — отчёт о выполнении → сохраняем + сообщение в группу стоп-бота.
 *
 * Auth: заголовок X-Lieferando-Agent-Key. Секрет — LIEFERANDO_AGENT_SECRET,
 * с фолбэком на PRINT_AGENT_SECRET (тот же ПК, тот же уровень доверия), чтобы
 * не плодить переменные на Vercel.
 */

export const dynamic = 'force-dynamic';

function authorized(request: NextRequest): boolean {
  const secret = (
    process.env.LIEFERANDO_AGENT_SECRET ||
    process.env.PRINT_AGENT_SECRET ||
    ''
  ).trim();
  if (!secret) return false;
  return request.headers.get('X-Lieferando-Agent-Key') === secret;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    await connectToDatabase();
    const agentId = request.headers.get('X-Lieferando-Agent-Id') || 'agent';
    const { command } = await claimLieferandoCommand(agentId);
    return NextResponse.json({ success: true, command });
  } catch (error) {
    console.error('[lieferando-agent] GET failed:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

const isAction = (v: unknown): v is LieferandoAction => v === 'off' || v === 'on';

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    await connectToDatabase();
    const body = await request.json();
    if (typeof body?.id !== 'string' || !isAction(body?.action)) {
      return NextResponse.json({ success: false, error: 'Bad request' }, { status: 400 });
    }

    const result = {
      id: body.id,
      action: body.action as LieferandoAction,
      ok: Boolean(body.ok),
      count: Number(body.count) || 0,
      failed: Number(body.failed) || 0,
      message: typeof body.message === 'string' ? body.message.slice(0, 500) : '',
    };
    await reportLieferandoResult(result);

    // Отчёт в группу — best-effort: провал Telegram не должен ронять отчёт.
    const text = result.ok
      ? result.action === 'off'
        ? `🛵 Lieferando: MakiLove <b>ВЫКЛЮЧЕН</b> — скрыто позиций: ${result.count}.` +
          (result.failed ? `\n⚠️ Не удалось: ${result.failed}.` : '') +
          '\nℹ️ Утром Lieferando включит их сам.'
        : `🛵 Lieferando: MakiLove <b>включён</b> — позиций: ${result.count}.` +
          (result.failed ? `\n⚠️ Не удалось: ${result.failed}.` : '')
      : `🛵❌ Lieferando: команда «${result.action === 'off' ? 'выключить' : 'включить'}» НЕ выполнена.\n${result.message || 'Причина неизвестна.'}`;
    await sendControlMessage(text);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[lieferando-agent] POST failed:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
