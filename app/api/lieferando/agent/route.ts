import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import {
  claimLieferandoCommand,
  formatLieferandoReport,
  lieferandoReportWanted,
  readLieferandoTarget,
  reportLieferandoResult,
  type LieferandoAction,
  type LieferandoReport,
} from '../../../../lib/lieferando-makilove';
import { sendControlMessage } from '../../../../lib/telegram-control';
import { maybeReapplyIndefiniteStops } from '../../../../lib/menu-stop/reapply-live';

/**
 * Обмен с агентом Lieferando (scripts/lieferando/agent.mjs на VDS/кассе).
 *
 * GET  — поллинг: агент забирает команду { id, action, target } (и heartbeat'ится).
 *        Заголовок X-Agent-Caps: targets — агент умеет цели size/item; без него
 *        (старый агент до самообновления) отдаём только команды MakiLove.
 *        Тем же поллингом раз в день (после 08:30 по Берлину) ставится
 *        перевыключение бессрочного стоп-листа (lib/menu-stop/reapply-live) —
 *        Hub к утру включает всё обратно.
 * POST — отчёт о выполнении → сохраняем + сообщение в группу стоп-бота
 *        (утреннее перевыключение бессрочного стоп-листа при успехе молчит —
 *        сводку шлёт сам крон, см. lieferandoReportWanted).
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
    const agentVersion = request.headers.get('X-Agent-Version');
    const caps = (request.headers.get('X-Agent-Caps') || '').split(/[\s,]+/);
    const now = new Date();
    const { command } = await claimLieferandoCommand(agentId, now, agentVersion, {
      supportsTargets: caps.includes('targets'),
    });
    // Утренний триггер — только агенту с целями size/item (старый выполнил бы их как MakiLove).
    if (caps.includes('targets')) await maybeReapplyIndefiniteStops(now);
    return NextResponse.json({ success: true, command });
  } catch (error) {
    console.error('[lieferando-agent] GET failed:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

const isAction = (v: unknown): v is LieferandoAction => v === 'off' || v === 'on';

const strings = (v: unknown, max: number): string[] | undefined =>
  Array.isArray(v)
    ? v
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, max)
    : undefined;

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

    const result: LieferandoReport = {
      id: body.id,
      action: body.action as LieferandoAction,
      // старый агент цель не шлёт — reportLieferandoResult возьмёт её из running
      target: readLieferandoTarget(body.target),
      ok: Boolean(body.ok),
      count: Number(body.count) || 0,
      failed: Number(body.failed) || 0,
      message: typeof body.message === 'string' ? body.message.slice(0, 500) : '',
    };
    if (typeof body.already === 'number') result.already = body.already;
    const categories = strings(body.categories, 30);
    if (categories) result.categories = categories;
    const notFound = strings(body.notFound, 30);
    if (notFound) result.notFound = notFound;

    const state = await reportLieferandoResult(result);

    // Отчёт в группу — best-effort: провал Telegram не должен ронять отчёт.
    if (state.lastResult && lieferandoReportWanted(state.lastResult)) {
      await sendControlMessage(formatLieferandoReport(state.lastResult));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[lieferando-agent] POST failed:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
