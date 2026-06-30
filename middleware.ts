import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { CANONICAL_HOST } from './lib/site-url';

/**
 * Канонизация хоста: неканоническая версия (apex `dumbospizza.de` и любой не-www
 * вариант прод-домена) делает ПОСТОЯННЫЙ 301-редирект на канон `www.dumbospizza.de`.
 * Так и в индексе, и при заходе остаётся одна версия сайта.
 *
 * Безопасность правок:
 *  - сравнение хоста точное → нет redirect loop (www на www не редиректит);
 *  - localhost и preview-домены (*.vercel.app и т.п.) НЕ трогаем → dev/preview целы;
 *  - редиректим только тот же домен без www, чтобы чужие хосты не ломать.
 */
export function middleware(req: NextRequest) {
  const host = (req.headers.get('host') || '').toLowerCase();

  // Только прод-домен без www (canonical = www). apexHost получаем из канона,
  // отбрасывая ведущий `www.`.
  const apexHost = CANONICAL_HOST.replace(/^www\./, '');
  const isCanonical = host === CANONICAL_HOST;
  const isApex = host === apexHost;

  if (isApex && !isCanonical) {
    const url = req.nextUrl.clone();
    url.host = CANONICAL_HOST;
    url.protocol = 'https:';
    url.port = '';
    return NextResponse.redirect(url, 301);
  }

  return NextResponse.next();
}

// Не запускаем middleware на внутренних ассетах Next и фавиконе — канонизация
// важна для страниц/SEO-ресурсов, а не для статики.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
