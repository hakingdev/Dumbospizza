"use client";

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { ShoppingCart, Menu, X, User, Phone, MapPin, ChevronDown } from 'lucide-react'
import { useLanguage } from '../lib/contexts/LanguageContext'
import { loadTranslation } from '../lib/i18n'
import { useCart } from '../lib/contexts/CartContext'
import { CartModal } from './cart/CartModal'

export function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCityModalOpen, setIsCityModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isCartModalOpen, setIsCartModalOpen] = useState(false);
  const [selectedCity, setSelectedCity] = useState('Bad Kissingen');
  const [cities, setCities] = useState<string[]>([]);
  const [storeInfo, setStoreInfo] = useState({
    phone: '022 210-210',
  });
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string) => k);
  const { cartItemsCount } = useCart();
  
  useEffect(() => {
    const loadCities = async () => {
      try {
        const response = await fetch('/api/delivery-zones');
        const data = await response.json();
        if (data.success) {
          const zoneNames = (data.zones || []).map((zone: any) => zone.name);
          setCities(zoneNames);
          const saved = localStorage.getItem('selectedCity');
          if (saved && zoneNames.includes(saved)) {
            setSelectedCity(saved);
          } else if (zoneNames.length > 0) {
            setSelectedCity(zoneNames[0]);
          }
        }
      } catch (error) {
        console.error('Error loading delivery zones:', error);
      }
    };

    loadCities();
  }, []);
  
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
          const phone = data.settings.phone || data.settings.supportPhone || '022 210-210';
          setStoreInfo({ phone });
        }
      } catch (error) {
        console.error('Error loading store settings:', error);
      }
    };

    loadStoreSettings();
  }, []);
  
  const handleCitySelect = (city: string) => {
    setSelectedCity(city);
    setIsCityModalOpen(false);
    localStorage.setItem('selectedCity', city);
  };
  
  return (
    <>
      <header className="bg-white shadow-md sticky top-0 z-50">
        {/* Top bar */}
        <div className="bg-primary-600 text-white py-2">
          <div className="container mx-auto px-4">
            <div className="flex justify-between items-center text-sm">
              <div className="flex items-center space-x-4">
                <button 
                  onClick={() => setIsCityModalOpen(true)}
                  className="flex items-center hover:text-primary-100 transition-colors"
                >
                  <MapPin className="h-4 w-4 mr-1" />
                  <span className="font-medium">{selectedCity}</span>
                  <ChevronDown className="h-4 w-4 ml-1" />
                </button>
              </div>
              <div className="hidden md:flex items-center space-x-4">
                <a href={`tel:${storeInfo.phone}`} className="flex items-center hover:text-primary-100 transition-colors">
                  <Phone className="h-4 w-4 mr-1" />
                  <span className="font-medium">{storeInfo.phone}</span>
                </a>
                <span>{t('header.hours', 'с 17:00 до 21:30 каждый день')}</span>
              </div>
            </div>
          </div>
        </div>
        
        {/* Main header */}
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link href="/" className="flex items-center">
              <div className="font-bold text-2xl text-primary-600">
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
            <div className="flex items-center space-x-4">
              <button 
                onClick={() => setIsLoginModalOpen(true)}
                className="hidden md:flex items-center text-gray-700 hover:text-primary-600 transition-colors"
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
                className="lg:hidden text-gray-700 hover:text-primary-600 p-2"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
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
              <a href="tel:+4997199999" className="flex items-center text-primary-600 hover:text-primary-700 py-2 font-medium">
                <Phone className="h-5 w-5 mr-2" />
                <span>022 210-210</span>
              </a>
            </nav>
          </div>
        )}
      </header>
      
      {/* City Selection Modal */}
      {isCityModalOpen && (
        <>
          <div 
            className="modal-backdrop"
            onClick={() => setIsCityModalOpen(false)}
          />
          <div className="modal-content">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-gray-900">
                  {t('city_modal.title', 'Где вы находитесь?')}
                </h2>
                <button 
                  onClick={() => setIsCityModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
              <p className="text-gray-600 mb-6">
                {t('city_modal.subtitle', 'Выберите город для правильного расчета доставки')}
              </p>
              <div className="space-y-2">
                {cities.length === 0 ? (
                  <div className="text-sm text-gray-500">
                    {t('city_modal.empty', 'Список районов пока пуст')}
                  </div>
                ) : (
                  cities.map((city) => (
                    <button
                      key={city}
                      onClick={() => handleCitySelect(city)}
                      className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${
                        selectedCity === city
                          ? 'border-primary-600 bg-primary-50 text-primary-700 font-medium'
                          : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{city}</span>
                        {selectedCity === city && (
                          <svg className="h-5 w-5 text-primary-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
      
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
