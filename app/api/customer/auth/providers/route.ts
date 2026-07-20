import { NextResponse } from 'next/server';
import { getEnabledProviders } from '../../../../../lib/auth/oauth/providers';

/**
 * GET /api/customer/auth/providers — какие кнопки внешнего входа рисовать.
 *
 * Форма входа не должна знать про env: если ключей Google/Apple в окружении нет,
 * список приходит пустым и кнопки просто не появляются (вместо кнопки, ведущей
 * на ошибку провайдера).
 */
export async function GET() {
  return NextResponse.json({ success: true, providers: getEnabledProviders() });
}
