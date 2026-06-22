"use client";

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Plus, ShoppingCart } from 'lucide-react'
import ProductModal from './ProductModal'
import { useLanguage } from '../lib/contexts/LanguageContext'
import { loadTranslation } from '../lib/i18n'
import { PromotionBadges, ProductCardPrice } from './promotions/PromotionBadges'
import { SafeImage } from './SafeImage'

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
  category: string;
  categoryId?: string;
  valentinePromo?: boolean;
}

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string) => k);

  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    };

    loadTranslations();
  }, [language]);
  
  const handleOpenModal = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsModalOpen(true);
  };
  
  return (
    <div 
      className={`group card relative flex h-full flex-col overflow-hidden rounded-2xl ${product.valentinePromo ? 'bg-rose-100 border-2 border-rose-200 shadow-md' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Image */}
      <div className="relative h-56 mb-4 overflow-hidden rounded-xl bg-gray-100">
        <PromotionBadges
          productId={product.id}
          categoryId={product.categoryId || product.category}
          className="absolute top-3 left-3 z-10"
        />
        {product.image ? (
          <SafeImage
            src={product.image}
            alt={product.name}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <div className="text-6xl mb-2">🍕</div>
              <span className="text-sm">{product.name}</span>
            </div>
          </div>
        )}
        
        {/* Quick add button on hover */}
        <button 
          className="absolute top-4 right-4 bg-white rounded-full p-3 shadow-lg hover:shadow-xl transition-all opacity-0 group-hover:opacity-100 z-10 hover:bg-primary-50"
          onClick={handleOpenModal}
        >
          <Plus className="h-5 w-5 text-primary-600" />
        </button>
      </div>
      
      <div className={`flex flex-1 flex-col px-2 ${product.valentinePromo ? 'pb-2' : ''}`}>
        <div className="mb-2 flex min-h-[3.25rem] items-start justify-between gap-3">
          <h3 className="flex min-w-0 items-start gap-1 text-lg font-bold leading-tight text-gray-900">
            <span className="min-w-0 break-words">{product.name}</span>
            {product.valentinePromo && (
              <span className="shrink-0 text-rose-500" title="Valentinstag Special">❤️</span>
            )}
          </h3>
          <ProductCardPrice
            productId={product.id}
            categoryId={product.categoryId || product.category}
            basePrice={product.price}
            fromLabel={t('product_card.from', 'от')}
          />
        </div>
        
        <p className="mb-4 min-h-[2.5rem] text-sm leading-5 text-gray-600 line-clamp-2">{product.description}</p>
        
        <button 
          onClick={handleOpenModal}
          className="mt-auto flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-3 text-center font-medium leading-tight text-white shadow-md transition-all hover:bg-primary-700 hover:shadow-lg"
        >
          <ShoppingCart className="h-5 w-5 shrink-0" />
          <span className="min-w-0">{t('product_card.choose_options', 'Выбрать опции')}</span>
        </button>
      </div>
      
      <ProductModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        productId={product.id}
      />
    </div>
  )
}
