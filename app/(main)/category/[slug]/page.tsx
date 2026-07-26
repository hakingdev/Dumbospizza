"use client";

import { useState, useEffect } from 'react';
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

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const response = await fetch(`/api/products?category=${encodeURIComponent(slug)}&available=true`);
        const data = await response.json();
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
        const response = await fetch('/api/categories?source=local');
        const data = await response.json();
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
        groupBySubcategory(products as any[], subcategories, (p: any) => p.subcategoryId)
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
                    price: product.basePrice,
                    image: product.image,
                    category: product.category
                  }} />
                ))}
              </div>
            </div>
          ))
      )}
    </div>
  );
}
