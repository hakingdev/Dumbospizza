"use client";

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { ShoppingCart, Menu, X, User, Phone } from 'lucide-react'
import { useLanguage } from '../lib/contexts/LanguageContext'
import { loadTranslation } from '../lib/i18n'
import { useCart } from '../lib/contexts/CartContext'
import { CartModal } from './cart/CartModal'
import { DEFAULT_STORE_PHONE, phoneToTelHref } from '../lib/store-phone'

export function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isCartModalOpen, setIsCartModalOpen] = useState(false);
  const [storeInfo, setStoreInfo] = useState({
    phone: DEFAULT_STORE_PHONE,
  });
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string) => k);
  const { cartItemsCount } = useCart();
  
  useEffect(() => {
    // Инициализация перевода
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    };
    
    loadTranslations();
  }, [language]);

  useEffect(() => {
    const loadStoreSettings = async () => {
      try {
        const response = await fetch('/api/settings/store', { cache: 'no-store' });
        const data = await response.json();
        if (data.success && data.settings) {
          const phone = data.settings.phone || data.settings.supportPhone || DEFAULT_STORE_PHONE;
          setStoreInfo({ phone });
        }
      } catch (error) {
        console.error('Error loading store settings:', error);
      }
    };

    loadStoreSettings();
  }, []);

  return (
    <>
      <header className="bg-white shadow-md sticky top-0 z-50">
        {/* Top bar */}
        <div className="bg-primary-600 text-white py-2">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-center text-center text-sm sm:justify-end sm:text-left">
              <div className="flex min-w-0 items-center justify-center gap-4 sm:justify-end">
                <a href={phoneToTelHref(storeInfo.phone)} className="hidden items-center whitespace-nowrap transition-colors hover:text-primary-100 sm:flex">
                  <Phone className="mr-1 h-4 w-4 shrink-0" />
                  <span className="font-medium">{storeInfo.phone}</span>
                </a>
                <span className="min-w-0 leading-tight">{t('header.hours', 'с 17:00 до 21:30 каждый день')}</span>
              </div>
            </div>
          </div>
        </div>
        
        {/* Main header */}
        <div className="container mx-auto px-4">
          <div className="flex h-16 items-center justify-between gap-3">
            {/* Logo */}
            <Link href="/" className="flex min-w-0 items-center">
              <div className="truncate text-xl font-bold text-primary-600 sm:text-2xl">
                🍕 <span className="text-gray-900">Dumbos</span>
                <span className="text-primary-600">Pizza</span>
              </div>
            </Link>
            
            {/* Desktop Navigation */}
            <nav className="hidden lg:flex items-center space-x-8">
              <Link href="/" className="text-gray-700 hover:text-primary-600 font-medium transition-colors">
                {t('nav.menu', 'Меню')}
              </Link>
              <Link href="/delivery" className="text-gray-700 hover:text-primary-600 font-medium transition-colors">
                {t('nav.delivery', 'Доставка')}
              </Link>
              <Link href="/about" className="text-gray-700 hover:text-primary-600 font-medium transition-colors">
                {t('nav.about', 'О нас')}
              </Link>
              <Link href="/track" className="text-gray-700 hover:text-primary-600 font-medium transition-colors">
                {t('nav.track', 'Отследить заказ')}
              </Link>
            </nav>
            
            {/* Action Buttons */}
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <button 
                onClick={() => setIsLoginModalOpen(true)}
                className="hidden h-12 w-12 items-center justify-center rounded-full text-gray-700 transition-colors hover:bg-primary-50 hover:text-primary-600 md:flex"
                title={t('nav.login', 'Войти')}
              >
                <User className="h-6 w-6" />
              </button>
              
              <button 
                onClick={() => setIsCartModalOpen(true)}
                className="relative flex items-center justify-center bg-primary-600 text-white rounded-full w-12 h-12 hover:bg-primary-700 transition-colors shadow-md"
                title={t('nav.cart', 'Корзина')}
              >
                <ShoppingCart className="h-6 w-6" />
                {cartItemsCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-secondary-600 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                    {cartItemsCount}
                  </span>
                )}
              </button>
              
              {/* Mobile menu button */}
              <button
                className="flex h-12 w-12 items-center justify-center rounded-full text-gray-700 transition-colors hover:bg-primary-50 hover:text-primary-600 lg:hidden"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                aria-label={t('nav.menu_toggle', 'Menü')}
              >
                {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </button>
            </div>
          </div>
        </div>
        
        {/* Mobile Navigation */}
        {isMenuOpen && (
          <div className="lg:hidden border-t bg-white">
            <nav className="container mx-auto px-4 py-4 flex flex-col space-y-3">
              <Link href="/" className="text-gray-700 hover:text-primary-600 py-2 font-medium" onClick={() => setIsMenuOpen(false)}>
                {t('nav.menu', 'Меню')}
              </Link>
              <Link href="/delivery" className="text-gray-700 hover:text-primary-600 py-2 font-medium" onClick={() => setIsMenuOpen(false)}>
                {t('nav.delivery', 'Доставка')}
              </Link>
              <Link href="/about" className="text-gray-700 hover:text-primary-600 py-2 font-medium" onClick={() => setIsMenuOpen(false)}>
                {t('nav.about', 'О нас')}
              </Link>
              <Link href="/track" className="text-gray-700 hover:text-primary-600 py-2 font-medium" onClick={() => setIsMenuOpen(false)}>
                {t('nav.track', 'Отследить заказ')}
              </Link>
              <button 
                onClick={() => {
                  setIsLoginModalOpen(true);
                  setIsMenuOpen(false);
                }}
                className="text-gray-700 hover:text-primary-600 py-2 font-medium text-left flex items-center"
              >
                <User className="h-5 w-5 mr-2" />
                {t('nav.login', 'Войти')}
              </button>
              <a href={phoneToTelHref(storeInfo.phone)} className="flex items-center text-primary-600 hover:text-primary-700 py-2 font-medium">
                <Phone className="h-5 w-5 mr-2" />
                <span>{storeInfo.phone}</span>
              </a>
            </nav>
          </div>
        )}
      </header>
      
      {/* Login Modal */}
      {isLoginModalOpen && (
        <>
          <div 
            className="modal-backdrop"
            onClick={() => setIsLoginModalOpen(false)}
          />
          <div className="modal-content">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-gray-900">
                  {t('login_modal.title', 'Вход')}
                </h2>
                <button 
                  onClick={() => setIsLoginModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
              <p className="text-gray-600 mb-6">
                {t('login_modal.subtitle', 'Введите номер телефона для входа')}
              </p>
              <div className="space-y-4">
                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                    {t('login_modal.phone_label', 'Номер телефона')}
                  </label>
                  <div className="flex">
                    <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-sm">
                      +49
                    </span>
                    <input
                      type="tel"
                      id="phone"
                      className="flex-1 border border-gray-300 rounded-r-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder={t('login_modal.phone_placeholder', '971 99999')}
                    />
                  </div>
                </div>
                <button className="btn-primary w-full">
                  {t('login_modal.send_code', 'Отправить код')}
                </button>
                <p className="text-xs text-gray-500 text-center">
                  {t('login_modal.agreement', 'Продолжая, вы соглашаетесь с')} {' '}
                  <Link href="/datenschutz" className="text-primary-600 hover:underline">
                    {t('footer.privacy', 'политикой конфиденциальности')}
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </>
      )}
      
      {/* Cart Modal */}
      <CartModal 
        isOpen={isCartModalOpen} 
        onClose={() => setIsCartModalOpen(false)} 
      />
    </>
  )
}
