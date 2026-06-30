import type { MetadataRoute } from 'next';
import { SITE_URL, CANONICAL_HOST } from '../lib/site-url';

// robots.txt генерируется из единого канона (www), чтобы Sitemap/Host не
// расходились с canonical и редиректом apex → www.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/admin/',
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: CANONICAL_HOST,
  };
}
