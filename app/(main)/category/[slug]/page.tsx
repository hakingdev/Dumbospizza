"use client";

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { ProductCard } from '../../../../components/product-card';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useLanguage } from '../../../../lib/contexts/LanguageContext';
import { loadTranslation } from '../../../../lib/i18n';
import {
  countBySubcategory,
  groupBySubcategory,
  readSubcategories,
  type Subcategory,
} from '../../../../lib/categories/subcategories';
import SubcategoryFilter from '../../../../components/SubcategoryFilter';
import { cachedJson } from '../../../../lib/client-cache';
import {
  PromotionBadgesProvider,
  readCategoryId,
  toBadgeItems,
} from '../../../../components/promotions/PromotionBadgesContext';
import { useKitchenBlocks } from '../../../../lib/contexts/KitchenBlocksContext';
import { getProductDisplayPrice } from '../../../../lib/product-pricing';

// useParams() liefert das URL-Segment ENKODIERT (z. B. "getr%C3%A4nke" für "getränke").
// Dekodieren, damit Anzeige korrekt ist und der Vergleich mit dem DB-slug ("getränke") greift.
function decodeSlug(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default function CategoryPage() {
  const params = useParams();
  const slug = decodeSlug((params.slug as string) || '');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [categoryName, setCategoryName] = useState<string>(slug);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  // null — показаны все; '' — только товары без подкатегории
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string, fallback?: string) => fallback ?? k);

  const categoryTitle = categoryName;
  // Бейджи акций для всей сетки — одним запросом вместо двух на карточку.
  const badgeItems = useMemo(() => toBadgeItems(products), [products]);

  // Вся категория на паузе (стоп-бот)? Говорим об этом СРАЗУ, до товаров.
  const { blockedWorkshopFor, messageFor } = useKitchenBlocks();
  const blockedWorkshop = useMemo(() => {
    const first: any = products[0];
    const categoryId = readCategoryId(first?.category ?? first?.categoryId);
    return categoryId ? blockedWorkshopFor({ categoryId }) : null;
  }, [products, blockedWorkshopFor]);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const data = await cachedJson(
          `/api/products?category=${encodeURIComponent(slug)}&available=true`
        );
        if (data.success) {
          setProducts(data.products);
        }
      } catch (error) {
        console.error('Error:', error);
      } finally {
        setLoading(false);
      }
    };

    const fetchCategory = async () => {
      try {
        const data = await cachedJson('/api/categories?source=local');
        if (data.success) {
          const match = (data.categories || []).find((cat: any) => cat.slug === slug);
          if (match) {
            setCategoryName(match.name);
            setSubcategories(readSubcategories(match));
          }
        }
      } catch (error) {
        console.error('Error:', error);
      }
    };

    fetchProducts();
    fetchCategory();
  }, [slug]);

  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    };

    loadTranslations();
  }, [language]);

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">{t('common.loading', 'Wird geladen...')}</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <Link href="/" className="mb-6 inline-flex max-w-full items-center gap-1 leading-tight text-primary-600 hover:text-primary-700">
        <ChevronLeft className="h-5 w-5 shrink-0" />
        {t('common.back', 'Zurück')}
      </Link>
      
      <h1 className="mb-8 break-words text-4xl font-bold leading-tight">{categoryTitle}</h1>

      {blockedWorkshop && (
        <div className="mb-8 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <span className="text-2xl leading-none" aria-hidden="true">
            ⏸️
          </span>
          <p className="text-sm leading-6 text-amber-900">{messageFor([blockedWorkshop])}</p>
        </div>
      )}

      <SubcategoryFilter
        subcategories={subcategories}
        counts={countBySubcategory(products as any[], subcategories, (p: any) => p.subcategoryId)}
        value={activeSub}
        onChange={setActiveSub}
        allLabel={t('category.all', 'Alle')}
        restLabel={t('category.other', 'Weitere')}
      />

      {products.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-xl text-gray-600">{t('category.empty', 'In dieser Kategorie gibt es noch keine Produkte')}</p>
        </div>
      ) : (
        <PromotionBadgesProvider items={badgeItems}>
          {groupBySubcategory(products as any[], subcategories, (p: any) => p.subcategoryId)
            .filter((sub) => activeSub === null || (sub.id ?? '') === activeSub)
            .map((sub) => (
              <div key={sub.id || 'ohne'} className="mb-10 last:mb-0">
                {sub.name && (
                  <h2 className="mb-4 text-xl font-semibold text-gray-700 md:text-2xl">{sub.name}</h2>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {sub.products.map((product: any) => (
                    <ProductCard key={product._id} product={{
                      id: product._id,
                      name: product.name,
                      description: product.description,
                      // «ab»-Preis aus den aktiven Größen — basePrice ist bei Größen-Produkten veraltet
                      price: getProductDisplayPrice(product),
                      image: product.image,
                      category: product.category
                    }} />
                  ))}
                </div>
              </div>
            ))}
        </PromotionBadgesProvider>
      )}
    </div>
  );
}
