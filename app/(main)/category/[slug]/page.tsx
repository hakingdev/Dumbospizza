"use client";

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { ProductCard } from '../../../../components/product-card';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useLanguage } from '../../../../lib/contexts/LanguageContext';
import { loadTranslation } from '../../../../lib/i18n';

export default function CategoryPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [categoryName, setCategoryName] = useState<string>(slug);
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string) => k);

  const categoryTitle = categoryName;

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const response = await fetch(`/api/products?category=${slug}&available=true`);
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
        <p className="mt-4 text-gray-600">{t('common.loading', 'Загрузка...')}</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <Link href="/" className="inline-flex items-center text-primary-600 hover:text-primary-700 mb-6">
        <ChevronLeft className="w-5 h-5 mr-1" />
        {t('common.back', 'Назад')}
      </Link>
      
      <h1 className="text-4xl font-bold mb-8">{categoryTitle}</h1>
      
      {products.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-xl text-gray-600">{t('category.empty', 'В этой категории пока нет товаров')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {products.map((product: any) => (
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
      )}
    </div>
  );
}
