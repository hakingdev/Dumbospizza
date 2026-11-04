import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../lib/models';
import { readLieferandoCatalog } from '../../../../../lib/lieferando/catalog';
import { receiveCatalogSnapshot } from '../../../../../lib/lieferando/catalog-live';
import { getLieferandoCatalogRecord } from '../../../../../lib/lieferando/catalog-store';

/**
 * Снимок каталога Lieferando от агента (scripts/lieferando/agent.mjs,
 * runCatalog в core.mjs): раз в сутки сам, по команде { kind: 'catalog' } из
 * очереди и вручную (`node toggle.mjs catalog --post`).
 *
 * POST { id?, reason, agentId, ok, takenAt, categories, failedCategories, error? }
 *      — сохраняем снимок в ключе `lieferandoCatalog`, сверяем с товарами
 *        сайта (lib/lieferando/catalog) и шлём в группу стоп-бота только
 *        изменения; ok=false — сообщение о сбое. id — закрываем команду в
 *        очереди агента отчётом.
 * GET  — текущий снимок (для отладки с теми же заголовками).
 *
 * Auth: заголовок X-Lieferando-Agent-Key (как у соседних роутов агента).
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
    return NextResponse.json({ success: true, catalog: await getLieferandoCatalogRecord() });
  } catch (error) {
    console.error('[lieferando-catalog] GET failed:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    await connectToDatabase();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Bad request' }, { status: 400 });
    }
    const ok = body.ok !== false;
    const catalog = ok ? readLieferandoCatalog(body) : null;
    if (ok && !catalog) {
      return NextResponse.json({ success: false, error: 'Empty catalog' }, { status: 400 });
    }
    const receipt = await receiveCatalogSnapshot({
      id: typeof body.id === 'string' ? body.id : null,
      reason: typeof body.reason === 'string' ? body.reason.slice(0, 20) : undefined,
      agentId: request.headers.get('X-Lieferando-Agent-Id') || undefined,
      ok,
      error: typeof body.error === 'string' ? body.error : '',
      catalog,
    });
    return NextResponse.json({ success: true, ...receipt });
  } catch (error) {
    console.error('[lieferando-catalog] POST failed:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
