import { NextResponse } from 'next/server';

/**
 * GET /api/print-agent-status
 * Проверка: подхватил ли сервер PRINT_AGENT_SECRET (для mark-printed).
 * Возвращает только факт настройки, без значения секрета.
 */
export async function GET() {
  const configured = Boolean(process.env.PRINT_AGENT_SECRET);
  return NextResponse.json({ configured });
}
