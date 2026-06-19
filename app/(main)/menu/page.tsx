"use client";

import { useState, useEffect } from 'react';
import { ProductCard } from '../../../components/product-card';
import { useLanguage } from '../../../lib/contexts/LanguageContext';
import { loadTranslation } from '../../../lib/i18n';

export default function MenuPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string) => k);

  useEffect(() => {
    fetchProducts();
  }, []);

  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    };

    loadTranslations();
  }, [language]);

  const fetchProducts = async () => {
    try {
      const response = await fetch('/api/products?available=true');
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

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">{t('menu.loading', 'Загрузка меню...')}</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <h1 className="text-4xl font-bold mb-8">{t('menu.title', 'Наше меню')}</h1>
      
      {products.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-xl text-gray-600 mb-6">{t('menu.empty', 'Меню пока пусто')}</p>
          <p className="text-gray-500">{t('menu.empty_hint', 'Скоро здесь появятся блюда. Добавьте товары через админ-панель.')}</p>
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
              category: product.category,
              valentinePromo: product.valentinePromo
            }} />
          ))}
        </div>
      )}
    </div>
  );
}

