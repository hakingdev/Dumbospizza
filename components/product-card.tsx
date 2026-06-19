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
      className={`group card relative overflow-hidden rounded-2xl ${product.valentinePromo ? 'bg-rose-100 border-2 border-rose-200 shadow-md' : ''}`}
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
      
      <div className={`px-2 ${product.valentinePromo ? 'pb-2' : ''}`}>
        <div className="flex items-start justify-between mb-2">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-1">
            {product.name}
            {product.valentinePromo && (
              <span className="text-rose-500" title="Valentinstag Special">❤️</span>
            )}
          </h3>
          <ProductCardPrice
            productId={product.id}
            categoryId={product.categoryId || product.category}
            basePrice={product.price}
            fromLabel={t('product_card.from', 'от')}
          />
        </div>
        
        <p className="text-gray-600 text-sm mb-4 line-clamp-2">{product.description}</p>
        
        <button 
          onClick={handleOpenModal}
          className="w-full bg-primary-600 text-white py-3 px-4 rounded-lg hover:bg-primary-700 transition-all font-medium shadow-md hover:shadow-lg flex items-center justify-center space-x-2"
        >
          <ShoppingCart className="h-5 w-5" />
          <span>{t('product_card.choose_options', 'Выбрать опции')}</span>
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
