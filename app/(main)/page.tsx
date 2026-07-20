"use client";

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { FeaturedProducts } from '../../components/featured-products'
import { CategoryProducts } from '../../components/category-products'
import { Hero } from '../../components/hero'
import { HomeBannerSlider } from '../../components/home-banner-slider'
import { ProductCard } from '../../components/product-card'
import { Truck, Award, Clock, Shield, Heart } from 'lucide-react'
import { useLanguage } from '../../lib/contexts/LanguageContext'
import { loadTranslation } from '../../lib/i18n'
import PreOrderModal from '../../components/PreOrderModal'
import { SafeImage } from '../../components/SafeImage'
import { formatOrderHoursTemplate, resolveOrderAcceptanceHours } from '../../lib/order-acceptance-hours'
import { storageGet, storageSet } from '../../lib/safe-storage'

const categoryColors = [
  'from-red-500 to-orange-500',
  'from-blue-500 to-cyan-500',
  'from-yellow-500 to-amber-500',
  'from-pink-500 to-rose-500',
  'from-green-500 to-emerald-500',
  'from-purple-500 to-violet-500'
];

const PRE_ORDER_MODAL_END_DATE = new Date('2025-02-13T00:00:00');
const OPENING_DATE = new Date('2026-02-12T00:00:00');

const categoryIcons: Record<string, string> = {
  pizza: '🍕',
  'mini-pizza-box': '🍕',
  drinks: '🥤',
  beverages: '🥤',
  appetizers: '🍟',
  desserts: '🍰',
  salads: '🥗'
};

function CategorySectionWrapper({
  category,
  t
}: {
  category: { name: string; slug: string; href: string; color: string };
  t: (key: string, defaultValue?: string) => string;
}) {
  const [hasProducts, setHasProducts] = useState<boolean | null>(null);
  const title = category.name;

  if (hasProducts === false) {
    return null;
  }

  return (
    <section className={`py-12 bg-white`}>
      <div className="container mx-auto px-4">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="min-w-0 text-3xl font-bold text-gray-900 md:text-4xl">{title}</h2>
          <Link href={category.href} className="inline-flex max-w-full shrink-0 items-center gap-1 self-start text-sm font-medium leading-tight text-primary-600 hover:text-primary-700 sm:text-base">
            <span className="truncate">{t('home.view_all', 'Alle')} {title.toLowerCase()}</span>
            <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
        <CategoryProducts 
          categorySlug={category.slug} 
          categoryTitle={title}
          limit={4}
          onProductsLoaded={setHasProducts}
        />
      </div>
    </section>
  );
}

export default function Home() {
  const { language } = useLanguage()
  const [t, setT] = useState<any>(() => (k: string, fallback?: string) => fallback ?? k)
  const [categories, setCategories] = useState<any[]>([])
  const [showPreOrderModal, setShowPreOrderModal] = useState(false)
  const [valentineProducts, setValentineProducts] = useState<any[]>([])
  const [valentineLoading, setValentineLoading] = useState(true)
  const [orderHours, setOrderHours] = useState(() => resolveOrderAcceptanceHours(null))

  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language)
      setT(() => translation)
    }

    loadTranslations()
  }, [language])

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const response = await fetch('/api/categories?source=local&active=true')
        const data = await response.json()
        if (data.success) {
          setCategories(data.categories || [])
        }
      } catch (error) {
        console.error('Error loading categories:', error)
      }
    }

    loadCategories()
  }, [])

  useEffect(() => {
    const fetchValentine = async () => {
      try {
        const res = await fetch('/api/products?available=true&valentinePromo=true&limit=8')
        const data = await res.json()
        if (data.success) setValentineProducts(data.products.slice(0, 8))
      } catch (e) {
        console.error(e)
      } finally {
        setValentineLoading(false)
      }
    }
    fetchValentine()
  }, [])

  useEffect(() => {
    const loadOrderHours = async () => {
      try {
        const response = await fetch('/api/settings/store', { cache: 'no-store' })
        const data = await response.json()
        if (data.success && data.settings) {
          setOrderHours(resolveOrderAcceptanceHours(data.settings))
        }
      } catch (error) {
        console.error('Error loading store settings:', error)
      }
    }

    loadOrderHours()
  }, [])

  // Check if we should show pre-order modal (before opening date)
  useEffect(() => {
    const now = new Date()
    if (now >= PRE_ORDER_MODAL_END_DATE) return

    // Show modal if we're before opening date and user hasn't closed it
    if (now < OPENING_DATE) {
      const hasSeenModal = storageGet('pre-order-modal-seen')
      if (!hasSeenModal) {
        // Show modal after a short delay
        const timer = setTimeout(() => {
          setShowPreOrderModal(true)
        }, 2000)
        return () => clearTimeout(timer)
      }
    }
  }, [])

  return (
    <main className="min-h-screen bg-gray-50">
      <PreOrderModal 
        isOpen={showPreOrderModal} 
        onClose={() => {
          setShowPreOrderModal(false)
          storageSet('pre-order-modal-seen', 'true')
        }} 
      />
      <Hero />
      <HomeBannerSlider />

      {/* Categories Section — как на скрине: слева Kategorien, справа Valentinstag Specials */}
      <section id="menu" className="py-12 bg-white">
        <div className="container mx-auto px-4">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="min-w-0 text-2xl font-bold text-black md:text-3xl">{t('home.categories', 'Kategorien')}</h2>
            {!valentineLoading && valentineProducts.length > 0 && (
              <Link
                href="/menu"
                className="inline-flex min-h-[48px] max-w-full items-center justify-center gap-2 self-start rounded-xl bg-rose-500 px-5 py-3 text-center font-bold leading-tight text-white shadow-md transition-all hover:bg-rose-600"
              >
                <Heart className="h-5 w-5 shrink-0 fill-current" />
                <span className="truncate">{t('home.valentinstag_specials', 'Valentinstag Specials')}</span>
              </Link>
            )}
          </div>
          <div className="flex overflow-x-auto space-x-4 py-4 px-2 -mx-2 -my-4 scrollbar-hide">
            {categories.map((category, index) => {
              const title = category.name;
              const color = categoryColors[index % categoryColors.length];
              const hasCustomIcon = category.icon && (category.icon.startsWith('/') || category.icon.startsWith('http'));
              const icon = hasCustomIcon ? category.icon : (categoryIcons[category.slug] || '🍽️');
              return (
                <Link
                  key={index}
                  href={`/category/${category.slug}`}
                  className="flex-shrink-0 group"
                >
                  <div className={`w-32 h-32 rounded-2xl bg-gradient-to-br ${color} p-1 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105`}>
                    <div className="w-full h-full bg-white rounded-xl flex flex-col items-center justify-center">
                      {hasCustomIcon ? (
                        <SafeImage src={icon} alt={title} className="w-12 h-12 object-contain mb-2" />
                      ) : (
                        <div className="text-4xl mb-2">{icon}</div>
                      )}
                      <span className="max-w-full px-2 text-center text-sm font-bold leading-tight text-gray-900 line-clamp-2">{title}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* Valentinstag Specials — показываем только если есть товары с акцией */}
      {!valentineLoading && valentineProducts.length > 0 && (
        <section className="py-12 bg-rose-50/50">
          <div className="container mx-auto px-4">
            <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="min-w-0 text-2xl font-bold text-gray-900 md:text-4xl">
                <span className="inline-flex max-w-full items-center gap-2 rounded-xl bg-rose-500 px-4 py-2 text-white">
                  <Heart className="h-6 w-6 shrink-0 fill-current" />
                  <span className="truncate">{t('home.valentinstag_specials', 'Valentinstag Specials')}</span>
                </span>
              </h2>
              <Link href="/menu" className="inline-flex shrink-0 items-center gap-1 self-start text-sm font-medium leading-tight text-rose-600 hover:text-rose-700 sm:text-base">
                <span>{t('home.all_menu', 'Alle Speisen')}</span>
                <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {valentineProducts.map((product: any) => (
                <ProductCard key={product._id} product={{
                  id: product._id,
                  name: product.name,
                  description: product.description,
                  price: product.basePrice,
                  image: product.image,
                  category: product.category,
                  valentinePromo: true
                }} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Featured Products */}
      <section className="py-12">
        <div className="container mx-auto px-4">
          <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="min-w-0 text-3xl font-bold text-gray-900 md:text-4xl">{t('home.popular', 'Beliebte Gerichte')}</h2>
            <Link href="/menu" className="inline-flex shrink-0 items-center gap-1 self-start text-sm font-medium leading-tight text-primary-600 hover:text-primary-700 sm:text-base">
              <span>{t('home.all_menu', 'Alle Speisen')}</span>
              <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
          <FeaturedProducts />
        </div>
      </section>

      {/* Category Products Sections */}
      {categories.map((category, index) => (
        <CategorySectionWrapper
          key={category.slug}
          category={{
            name: category.name,
            slug: category.slug,
            href: `/category/${category.slug}`,
            color: categoryColors[index % categoryColors.length]
          }}
          t={t}
        />
      ))}

      {/* Benefits Section */}
      <section className="py-12 bg-white">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="text-center p-6 rounded-2xl bg-gradient-to-br from-primary-50 to-white border border-primary-100">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-full mb-4">
                <Truck className="h-8 w-8 text-primary-600" />
              </div>
              <h3 className="text-lg font-bold mb-2">{t('home.benefits.fast_title', 'Schnelle Lieferung')}</h3>
              <p className="text-gray-600 text-sm">{t('home.benefits.fast_text', '30-60 Minuten, zu Stoßzeiten bis 90 Minuten')}</p>
            </div>
            
            <div className="text-center p-6 rounded-2xl bg-gradient-to-br from-secondary-50 to-white border border-secondary-100">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-secondary-100 rounded-full mb-4">
                <Award className="h-8 w-8 text-secondary-600" />
              </div>
              <h3 className="text-lg font-bold mb-2">{t('home.benefits.quality_title', 'Beste Qualität')}</h3>
              <p className="text-gray-600 text-sm">{t('home.benefits.quality_text', 'Nur frische Zutaten')}</p>
            </div>
            
            <div className="text-center p-6 rounded-2xl bg-gradient-to-br from-orange-50 to-white border border-orange-100">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-orange-100 rounded-full mb-4">
                <Clock className="h-8 w-8 text-orange-600" />
              </div>
              <h3 className="text-lg font-bold mb-2">{formatOrderHoursTemplate(t('home.benefits.hours_title', 'Täglich geöffnet'), orderHours)}</h3>
              <p className="text-gray-600 text-sm">{formatOrderHoursTemplate(t('home.benefits.hours_text', 'Täglich von {start} bis {end}'), orderHours)}</p>
            </div>
            
            <div className="text-center p-6 rounded-2xl bg-gradient-to-br from-blue-50 to-white border border-blue-100">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
                <Shield className="h-8 w-8 text-blue-600" />
              </div>
              <h3 className="text-lg font-bold mb-2">{t('home.benefits.safe_title', 'Sicherheit')}</h3>
              <p className="text-gray-600 text-sm">{t('home.benefits.safe_text', 'Qualität und Frische garantiert')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Loyalty Program Banner */}
      <section className="py-16 bg-gradient-to-br from-primary-600 to-primary-800">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center text-white">
            <div className="text-6xl mb-6">🎁</div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">{t('home.loyalty.title', 'Treueprogramm')}</h2>
            <p className="text-lg md:text-xl mb-8 text-white/90">
              {t('home.loyalty.text', 'Sammeln Sie Punkte bei jeder Bestellung und erhalten Sie Rabatte auf zukünftige Einkäufe. Geben Sie einfach Ihre Telefonnummer beim Checkout an.')}
            </p>
            <Link href="/profile" className="inline-flex min-h-[56px] items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-white px-8 py-4 text-center text-lg font-bold leading-tight text-primary-700 shadow-xl transition-all hover:bg-gray-100 hover:shadow-2xl">
              <span>{t('home.loyalty.cta', 'Mehr erfahren')}</span>
              <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </section>
      
      {/* Info Cards */}
      <section className="py-12">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-white rounded-2xl p-8 shadow-lg border border-gray-100 hover:shadow-xl transition-all">
              <div className="text-5xl mb-4">🚚</div>
              <h3 className="text-2xl font-bold mb-4 text-gray-900">{t('home.info.delivery_title', 'Liefergebiete')}</h3>
              <p className="text-gray-600 mb-6">
                {t('home.info.delivery_text', 'Wir liefern Pizza in viele Stadtteile. Der Mindestbestellwert hängt vom Liefergebiet ab. Kostenlose Lieferung ab 30 €.')}
              </p>
              <Link href="/delivery" className="inline-flex max-w-full items-center gap-1 font-bold leading-tight text-primary-600 hover:text-primary-700">
                <span className="truncate">{t('home.info.delivery_cta', 'Liefergebiete ansehen')}</span>
                <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
            
            <div className="bg-gradient-to-br from-primary-600 to-primary-800 text-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all">
              <div className="text-5xl mb-4">📱</div>
              <h3 className="text-2xl font-bold mb-4">{t('home.info.track_title', 'Bestellung verfolgen')}</h3>
              <p className="text-white/90 mb-6">
                {t('home.info.track_text', 'Verfolgen Sie den Status Ihrer Bestellung in Echtzeit und bleiben Sie über Zubereitung und Lieferung informiert.')}
              </p>
              <Link href="/track" className="inline-flex min-h-[48px] items-center justify-center gap-1 whitespace-nowrap rounded-lg bg-white px-6 py-3 text-center font-bold leading-tight text-primary-700 transition-all hover:bg-gray-100">
                <span>{t('home.info.track_cta', 'Verfolgen')}</span>
                <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
