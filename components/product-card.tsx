"use client";

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
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
import { useHalloween } from './halloween/HalloweenProvider'
import { flareHalloweenCard, HW_TAP_OPEN_DELAY_MS } from './halloween/bus'

// Halloween: огонь при наведении. Чанк грузится, только когда режим включён.
const HalloweenCardFire = dynamic(() => import('./halloween/CardFire'), { ssr: false })

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
  // Модалка раскрывается из фото карточки — центр фото в координатах окна.
  const imageRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // Halloween на телефоне: товар открывается после вспышки — второй тап в эту паузу не считаем.
  const flarePendingRef = useRef(false);
  const [modalOrigin, setModalOrigin] = useState<{ x: number; y: number } | null>(null);
  const { language } = useLanguage();
  const halloween = useHalloween();
  // Halloween прячет валентинскую подсветку: розовое на ночной витрине не к месту.
  const valentine = !!product.valentinePromo && !halloween.enabled;
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
    if (flarePendingRef.current) return;
    const open = () => {
      flarePendingRef.current = false;
      const rect = imageRef.current?.getBoundingClientRect();
      setModalOrigin(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null);
      setIsModalOpen(true);
    };
    if (halloween.night && flareHalloweenCard(cardRef.current, 2000)) {
      flarePendingRef.current = true;
      setTimeout(open, HW_TAP_OPEN_DELAY_MS);
      return;
    }
    open();
  };

  const ctaLabel = blockedWorkshop
    ? WORKSHOP_BLOCK_HEADLINE
    : isMiniBox
      ? t('product_card.build_box', 'Box zusammenstellen')
      : t('product_card.choose_options', 'Optionen wählen');

  // Карточка: на телефоне — строка «фото слева, текст справа» (плотный список
  // как у агрегаторов, ~в 3 раза короче ленты), с md — вертикальная карточка.
  // Цена живёт у кнопки (решение), название с описанием — над ними (что это).
  return (
    <div
      ref={cardRef}
      className={`group card relative flex h-full flex-row gap-3 overflow-hidden rounded-2xl p-3 md:flex-col md:gap-0 md:p-4 ${valentine ? 'bg-rose-100 border-2 border-rose-200 shadow-md' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Фото открывает товар — на телефоне это самая крупная цель для пальца */}
      <button
        type="button"
        onClick={handleOpenModal}
        aria-label={`${product.name}: ${ctaLabel}`}
        ref={imageRef}
        className="relative h-28 w-28 shrink-0 overflow-hidden rounded-xl bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700 md:mb-4 md:h-56 md:w-full"
      >
        {/* На фото бейджи только с md: в 112-px превью телефона длинный текст акции закрывал бы пиццу */}
        <PromotionBadges
          productId={product.id}
          categoryId={categoryId}
          className="absolute left-3 top-3 z-10 hidden md:flex"
        />
        {blockedWorkshop && (
          <span className="absolute inset-x-0 bottom-0 z-20 bg-gray-900/80 px-1.5 py-1 text-center text-[11px] font-semibold leading-tight text-white md:px-3 md:py-2 md:text-xs">
            ⏸️ {badgeFor(blockedIds)}
          </span>
        )}
        {product.image ? (
          <SafeImage
            src={product.image}
            alt=""
            // Лёгкий поворот пиццы при наведении (только мышь). scale-110 прячет
            // углы фото, которые иначе открылись бы при повороте на 6°.
            className={`absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out [@media(hover:hover)]:group-hover:rotate-6 [@media(hover:hover)]:group-hover:scale-110 motion-reduce:transition-none motion-reduce:transform-none ${blockedWorkshop ? 'opacity-50 grayscale' : ''}`}
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 text-4xl md:text-6xl" aria-hidden="true">
            🍕
          </span>
        )}
        {/* Hover-подсказка на десктопе; на тач-экранах клик по фото и так открывает товар */}
        <span
          aria-hidden="true"
          className="absolute right-4 top-4 z-10 hidden rounded-full bg-white p-3 shadow-lg transition-all md:block md:opacity-0 md:group-hover:opacity-100"
        >
          <Plus className="h-5 w-5 text-primary-700" />
        </span>
      </button>

      <div className="flex min-w-0 flex-1 flex-col md:px-2">
        <PromotionBadges
          productId={product.id}
          categoryId={categoryId}
          className="mb-1 min-w-0 flex-nowrap md:hidden"
          compact
        />
        <h3 className="flex items-start gap-1 text-base font-bold leading-tight text-gray-900 md:min-h-[2.75rem] md:text-lg">
          <NoTranslate className="line-clamp-2 min-w-0 break-words hyphens-auto text-balance">{product.name}</NoTranslate>
          {valentine && (
            <span className="shrink-0 text-rose-500" title="Valentinstag Special">❤️</span>
          )}
        </h3>

        <p className="mt-1 line-clamp-2 text-sm leading-5 text-gray-600 text-pretty md:min-h-[2.5rem]">{product.description}</p>

        <div className="mt-auto flex items-end justify-between gap-3 pt-2 md:block md:pt-4">
          <ProductCardPrice
            productId={product.id}
            categoryId={categoryId}
            basePrice={product.price}
            fromLabel={t('product_card.from', 'Preis ab')}
          />

          <button
            type="button"
            onClick={handleOpenModal}
            aria-disabled={!!blockedWorkshop}
            className={`flex h-11 w-11 shrink-0 items-center justify-center gap-2 rounded-full font-medium leading-tight shadow-md transition-all md:mt-3 md:h-auto md:min-h-[44px] md:w-full md:rounded-lg md:px-4 md:py-3 ${
              blockedWorkshop
                ? 'cursor-not-allowed bg-gray-200 text-gray-600'
                : 'bg-primary-600 text-white hover:bg-primary-700 hover:shadow-lg'
            }`}
          >
            {blockedWorkshop ? (
              <span className="sr-only md:not-sr-only md:min-w-0">{ctaLabel}</span>
            ) : (
              <>
                <Plus className="h-5 w-5 shrink-0 md:hidden" aria-hidden="true" />
                <ShoppingCart className="hidden h-5 w-5 shrink-0 md:block" aria-hidden="true" />
                <span className="sr-only md:not-sr-only md:min-w-0">{ctaLabel}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {halloween.night && <HalloweenCardFire suppressed={isModalOpen} />}

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
          origin={modalOrigin}
          preview={{ name: product.name, image: product.image }}
        />
      )}
    </div>
  )
}
