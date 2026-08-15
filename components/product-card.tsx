"use client";

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Plus, ShoppingCart } from 'lucide-react'
import ProductModal from './ProductModal'
import { useLanguage } from '../lib/contexts/LanguageContext'
import { useKitchenBlocks } from '../lib/contexts/KitchenBlocksContext'
import { WORKSHOP_BLOCK_HEADLINE } from '../lib/kitchen/workshops'
import { loadTranslation } from '../lib/i18n'
import { PromotionBadges, ProductCardPrice } from './promotions/PromotionBadges'
import { readCategoryId } from './promotions/PromotionBadgesContext'
import { SafeImage } from './SafeImage'
import { NoTranslate } from './NoTranslate'
import { MiniPizzaBoxBuilder } from './mini-pizza-box/MiniPizzaBoxBuilder'
import { MINI_BOX_CATEGORY_SLUG } from '../lib/mini-pizza-box'

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
  /** slug-строка или populated-объект категории (как отдаёт /api/products) */
  category: any;
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
  const [t, setT] = useState<any>(() => (k: string, fallback?: string) => fallback ?? k);

  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    };

    loadTranslations();
  }, [language]);
  
  // «4er Mini Pizza Box»: statt Standard-Modal den Vollbild-Konfigurator öffnen.
  const rawCategory: any = product.category;
  const isMiniBox = rawCategory?.slug === MINI_BOX_CATEGORY_SLUG;
  // /api/products liefert die Kategorie POPULIERT — als Objekt, nicht als id.
  const categoryId = readCategoryId(product.categoryId ?? product.category);

  // Цех этой позиции остановлен (стоп-бот)? Тогда карточка не открывается:
  // гость сразу видит «keine Bestellungen möglich» и по клику получает объяснение с минутами.
  const { blockedWorkshopFor, badgeFor, showNotice } = useKitchenBlocks();
  const blockedWorkshop = blockedWorkshopFor({ categoryId, name: product.name });
  const blockedIds = blockedWorkshop ? [blockedWorkshop] : [];

  const handleOpenModal = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (blockedWorkshop) {
      showNotice(blockedIds);
      return;
    }
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
          categoryId={categoryId}
          className="absolute top-3 left-3 z-10"
        />
        {blockedWorkshop && (
          <div className="absolute inset-x-0 bottom-0 z-20 bg-gray-900/80 px-3 py-2 text-center text-xs font-semibold text-white">
            ⏸️ {badgeFor(blockedIds)}
          </div>
        )}
        {product.image ? (
          <SafeImage
            src={product.image}
            alt={product.name}
            className={`absolute inset-0 h-full w-full object-cover ${blockedWorkshop ? 'opacity-50 grayscale' : ''}`}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <div className="text-6xl mb-2">🍕</div>
              <NoTranslate className="text-sm">{product.name}</NoTranslate>
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
          <h3 className="flex min-w-0 flex-1 items-start gap-1 text-lg font-bold leading-tight text-gray-900">
            <NoTranslate className="min-w-0 break-words hyphens-auto">{product.name}</NoTranslate>
            {product.valentinePromo && (
              <span className="shrink-0 text-rose-500" title="Valentinstag Special">❤️</span>
            )}
          </h3>
          <ProductCardPrice
            productId={product.id}
            categoryId={categoryId}
            basePrice={product.price}
            fromLabel={t('product_card.from', 'Preis ab')}
          />
        </div>
        
        <p className="mb-4 min-h-[2.5rem] text-sm leading-5 text-gray-600 line-clamp-2">{product.description}</p>
        
        <button
          onClick={handleOpenModal}
          aria-disabled={!!blockedWorkshop}
          className={`mt-auto flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-center font-medium leading-tight shadow-md transition-all ${
            blockedWorkshop
              ? 'cursor-not-allowed bg-gray-200 text-gray-600'
              : 'bg-primary-600 text-white hover:bg-primary-700 hover:shadow-lg'
          }`}
        >
          {blockedWorkshop ? (
            <span className="min-w-0">{WORKSHOP_BLOCK_HEADLINE}</span>
          ) : (
            <>
              <ShoppingCart className="h-5 w-5 shrink-0" />
              <span className="min-w-0">
                {isMiniBox
                  ? t('product_card.build_box', 'Box zusammenstellen')
                  : t('product_card.choose_options', 'Optionen wählen')}
              </span>
            </>
          )}
        </button>
      </div>

      {isMiniBox ? (
        <MiniPizzaBoxBuilder
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          product={{
            id: product.id,
            name: product.name,
            image: product.image,
            categoryId: rawCategory?._id || rawCategory?.id || product.categoryId,
          }}
        />
      ) : (
        <ProductModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          productId={product.id}
        />
      )}
    </div>
  )
}
