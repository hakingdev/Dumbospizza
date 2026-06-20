import { connectToDatabase } from '../models';
import { getProducts, getCategories, getProductById } from '../db/utils';
import { Category } from '../models/category.model';
import { getMewsPosEnabled } from '../settings';
import {
  fetchMewsPosProducts,
  fetchMewsPosCategories,
  fetchMewsPosProductById,
} from '../mews-pos/sync';

export interface SeoProduct {
  _id: string;
  name: string;
  description?: string;
  image?: string;
  available?: boolean;
  updatedAt?: Date | string;
}

export interface SeoCategory {
  _id?: string;
  name: string;
  slug: string;
  updatedAt?: Date | string;
}

/**
 * Каталог для sitemap/метаданных. Учитывает источник товаров (Mews POS либо
 * локальная БД) так же, как публичные API-роуты — чтобы URL в sitemap совпадали
 * с тем, что реально видят пользователи и Googlebot.
 */
export async function getSitemapCatalog(): Promise<{
  products: SeoProduct[];
  categories: SeoCategory[];
}> {
  try {
    await connectToDatabase();
    const mewsEnabled = await getMewsPosEnabled();

    if (mewsEnabled) {
      const [products, categories] = await Promise.all([
        fetchMewsPosProducts({ available: true }),
        fetchMewsPosCategories(),
      ]);
      return {
        products: products as unknown as SeoProduct[],
        categories: categories as unknown as SeoCategory[],
      };
    }

    const [products, categories] = await Promise.all([
      getProducts({ available: true }),
      getCategories({ active: true }),
    ]);
    return {
      products: products as unknown as SeoProduct[],
      categories: categories as unknown as SeoCategory[],
    };
  } catch (error) {
    console.error('[seo] getSitemapCatalog failed:', error);
    return { products: [], categories: [] };
  }
}

export async function getProductForSeo(id: string): Promise<SeoProduct | null> {
  try {
    await connectToDatabase();
    const mewsEnabled = await getMewsPosEnabled();
    const product = mewsEnabled
      ? await fetchMewsPosProductById(id)
      : await getProductById(id);
    return (product as unknown as SeoProduct) || null;
  } catch (error) {
    console.error('[seo] getProductForSeo failed:', error);
    return null;
  }
}

export async function getCategoryForSeo(slug: string): Promise<SeoCategory | null> {
  try {
    await connectToDatabase();
    const mewsEnabled = await getMewsPosEnabled();
    if (mewsEnabled) {
      const categories = await fetchMewsPosCategories();
      return (
        (categories.find((c) => c.slug === slug) as unknown as SeoCategory) || null
      );
    }
    const category = await Category.findOne({ slug });
    return (category as unknown as SeoCategory) || null;
  } catch (error) {
    console.error('[seo] getCategoryForSeo failed:', error);
    return null;
  }
}
