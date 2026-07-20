import { NextRequest, NextResponse } from 'next/server';
import {
  getProviderConfig,
  isOAuthProvider,
} from '../../../../../../../lib/auth/oauth/providers';
import { buildAuthorizeUrl } from '../../../../../../../lib/auth/oauth/flow';
import { createTransaction, setTransactionCookie } from '../../../../../../../lib/auth/oauth/state';
import { SITE_URL } from '../../../../../../../lib/site-url';

/**
 * GET /api/customer/auth/oauth/{google|apple}/start — начало внешнего входа.
 *
 * Заводит транзакцию (state + nonce + адрес возврата) в подписанной cookie и
 * уводит на экран согласия провайдера.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { provider: string } }
) {
  if (!isOAuthProvider(params.provider)) {
    return NextResponse.json({ success: false, error: 'Unbekannter Anbieter' }, { status: 404 });
  }

  const config = getProviderConfig(params.provider);
  if (!config) {
    // Ключей в окружении нет: возвращаем на форму с понятной причиной, а не
    // отдаём пользователя провайдеру с пустым client_id.
    return NextResponse.redirect(`${SITE_URL}/account?error=provider_unavailable`);
  }

  const tx = createTransaction(params.provider, request.nextUrl.searchParams.get('returnTo'));
  const response = NextResponse.redirect(buildAuthorizeUrl(config, tx));
  return setTransactionCookie(response, tx, { crossSitePost: config.usesFormPost });
}
