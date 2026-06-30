/**
 * Единый источник правды для КАНОНИЧЕСКОГО адреса сайта.
 *
 * Канон — версия с `www` (`https://www.dumbospizza.de`): на проде apex
 * `dumbospizza.de` делает постоянный редирект на `www` (Vercel-домен + см.
 * [middleware.ts]). Чтобы поисковики не индексировали обе версии, ВСЕ абсолютные
 * SEO-ссылки (canonical, og:url, sitemap, robots, structured data, ссылки в
 * письмах/WhatsApp) должны указывать на этот один адрес.
 *
 * Переопределяется через `NEXT_PUBLIC_SITE_URL` (прод/стейдж/preview).
 * Намеренно НЕ опираемся на `NEXTAUTH_URL` — это адрес auth-callback’ов
 * (часто apex или localhost) и его смешивание с публичным каноном как раз и
 * приводило к расхождению www/non-www.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://www.dumbospizza.de'
).replace(/\/$/, '');

/** Хост канона без протокола, напр. `www.dumbospizza.de`. */
export const CANONICAL_HOST = (() => {
  try {
    return new URL(SITE_URL).host;
  } catch {
    return 'www.dumbospizza.de';
  }
})();
