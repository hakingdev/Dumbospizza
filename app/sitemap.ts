import type { MetadataRoute } from 'next';
import { getSitemapCatalog } from '../lib/seo/catalog';
import { SITE_URL } from '../lib/site-url';

const siteUrl = SITE_URL;

// Генерируется при запросе (товары/категории берутся из БД или Mews POS).
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${siteUrl}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${siteUrl}/menu`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${siteUrl}/angebote`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${siteUrl}/delivery`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${siteUrl}/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
  ];

  const { products, categories } = await getSitemapCatalog();

  const categoryRoutes: MetadataRoute.Sitemap = categories
    .filter((c) => c.slug)
    .map((c) => ({
      url: `${siteUrl}/category/${c.slug}`,
      lastModified: c.updatedAt ? new Date(c.updatedAt) : now,
      changeFrequency: 'weekly',
      priority: 0.7,
    }));

  const productRoutes: MetadataRoute.Sitemap = products
    .filter((p) => p._id)
    .map((p) => ({
      url: `${siteUrl}/product/${p._id}`,
      lastModified: p.updatedAt ? new Date(p.updatedAt) : now,
      changeFrequency: 'weekly',
      priority: 0.6,
    }));

  return [...staticRoutes, ...categoryRoutes, ...productRoutes];
}
