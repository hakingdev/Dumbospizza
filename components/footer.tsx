"use client"

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Mail, Phone, MapPin, Clock } from 'lucide-react'
import { useLanguage } from '../lib/contexts/LanguageContext'
import { loadTranslation } from '../lib/i18n'
import { getCookie } from 'cookies-next'
import { cookieName } from '../lib/i18n-config'

const DEFAULT_STORE_INFO = {
  address: 'Kurhausstraße 11A, 97688 Bad Kissingen',
  phone: '+49 971 99999',
  email: 'info@dumbospizza.de',
  facebook: '',
  instagram: ''
}

export function Footer() {
  const { language } = useLanguage()
  const [t, setT] = useState<any>(() => (k: string) => k)
  const cookieLang = getCookie(cookieName) as string | undefined
  const resolvedLanguage = cookieLang || language
  const fallback = (ru: string, de: string) => de
  const [storeInfo, setStoreInfo] = useState(DEFAULT_STORE_INFO);
  const [categories, setCategories] = useState<any[]>([]);

  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language)
      setT(() => translation)
    }

    loadTranslations()
  }, [language])

  useEffect(() => {
    const loadStoreSettings = async () => {
      try {
        const response = await fetch('/api/settings/store', { cache: 'no-store' });
        const data = await response.json();
        if (data.success && data.settings) {
          const address = data.settings.address || DEFAULT_STORE_INFO.address;
          const phone = data.settings.phone || data.settings.supportPhone || DEFAULT_STORE_INFO.phone;
          const email = data.settings.email || data.settings.contactEmail || DEFAULT_STORE_INFO.email;
          const facebook = data.settings.facebook || '';
          const instagram = data.settings.instagram || '';
          setStoreInfo({ address, phone, email, facebook, instagram });
        }
      } catch (error) {
        console.error('Error loading store settings:', error);
      }
    };

    loadStoreSettings();
  }, []);

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const response = await fetch('/api/categories?active=true&source=local');
        const data = await response.json();
        if (data.success && data.categories) {
          setCategories(data.categories || []);
        }
      } catch (error) {
        console.error('Error loading categories:', error);
      }
    };

    loadCategories();
  }, []);

  return (
    <footer className="bg-gray-900 text-gray-300">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Company Info */}
          <div>
            <h3 className="text-white text-lg font-semibold mb-4">Dumbos Pizza</h3>
            <p className="mb-4">
              {t('footer.description', fallback('Лучшая пицца в Bad Kissingen с доставкой на дом или в офис.', 'Die beste Pizza in Bad Kissingen mit Lieferung nach Hause oder ins Büro.'))}
            </p>
            <div className="flex space-x-4">
              {storeInfo.facebook && (
                <a 
                  href={storeInfo.facebook} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="text-gray-300 hover:text-white transition-colors"
                  aria-label="Facebook"
                >
                  <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path fillRule="evenodd" d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" clipRule="evenodd" />
                  </svg>
                </a>
              )}
              {storeInfo.instagram && (
                <a 
                  href={storeInfo.instagram} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="text-gray-300 hover:text-white transition-colors"
                  aria-label="Instagram"
                >
                  <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                  </svg>
                </a>
              )}
            </div>
          </div>
          
          {/* Navigation */}
          <div>
            <h3 className="text-white text-lg font-semibold mb-4">{t('footer.menu_title', fallback('Меню', 'Speisekarte'))}</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/menu" className="hover:text-white">
                  {t('footer.all_menu', fallback('Все меню', 'Alle Speisen'))}
                </Link>
              </li>
              {categories.map((category) => (
                <li key={category._id || category.slug}>
                  <Link href={`/category/${category.slug}`} className="hover:text-white">
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          
          {/* Information */}
          <div>
            <h3 className="text-white text-lg font-semibold mb-4">{t('footer.info_title', fallback('Информация', 'Information'))}</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/about" className="hover:text-white">
                  {t('footer.about', fallback('О нас', 'Über uns'))}
                </Link>
              </li>
              <li>
                <Link href="/delivery" className="hover:text-white">
                  {t('footer.delivery', fallback('Доставка', 'Lieferung'))}
                </Link>
              </li>
              <li>
                <Link href="/impressum" className="hover:text-white">
                  {t('footer.impressum', fallback('Impressum', 'Impressum'))}
                </Link>
              </li>
              <li>
                <Link href="/datenschutz" className="hover:text-white">
                  {t('footer.privacy', fallback('Datenschutz', 'Datenschutz'))}
                </Link>
              </li>
              <li>
                <Link href="/agb" className="hover:text-white">
                  {t('footer.agb', fallback('AGB', 'AGB'))}
                </Link>
              </li>
              <li>
                <Link href="/widerrufsbelehrung" className="hover:text-white">
                  {t('footer.withdrawal', fallback('Widerrufsbelehrung', 'Widerrufsbelehrung'))}
                </Link>
              </li>
            </ul>
          </div>
          
          {/* Contact */}
          <div>
            <h3 className="text-white text-lg font-semibold mb-4">{t('footer.contacts_title', fallback('Контакты', 'Kontakt'))}</h3>
            <ul className="space-y-3">
              <li className="flex items-start">
                <MapPin className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0" />
                <span>{storeInfo.address}</span>
              </li>
              <li className="flex items-center">
                <Phone className="h-5 w-5 mr-2 flex-shrink-0" />
                <a href={`tel:${storeInfo.phone}`} className="hover:text-white">{storeInfo.phone}</a>
              </li>
              <li className="flex items-center">
                <Mail className="h-5 w-5 mr-2 flex-shrink-0" />
                <a href={`mailto:${storeInfo.email}`} className="hover:text-white">{storeInfo.email}</a>
              </li>
              <li className="flex items-center">
                <Clock className="h-5 w-5 mr-2 flex-shrink-0" />
                <span>{t('header.hours', fallback('с 17:00 до 21:30 каждый день', 'Täglich 17:00 - 21:30'))}</span>
              </li>
            </ul>
          </div>
        </div>
        
        <div className="border-t border-gray-800 mt-10 pt-6">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="text-sm text-center md:text-left">
              <p>&copy; {new Date().getFullYear()} Dumbos Pizza. {t('footer.copyright', fallback('Все права защищены.', 'Alle Rechte vorbehalten.'))}</p>
            </div>
            
            {/* Payment methods */}
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
              <span className="text-sm text-gray-400">{t('footer.payment_methods', fallback('Способы оплаты:', 'Zahlungsmethoden:'))}</span>
              <div className="flex flex-wrap items-center justify-center gap-3">
                {/* Cash */}
                <div className="bg-white rounded px-3 py-1 text-gray-700 font-medium text-sm">
                  Cash
                </div>
                {/* Card */}
                <div className="bg-white rounded px-3 py-1 flex items-center gap-1">
                  <svg className="h-6 w-auto" viewBox="0 0 48 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect width="48" height="32" rx="4" fill="#0066B2"/>
                    <circle cx="18" cy="16" r="8" fill="#FF6900"/>
                    <circle cx="30" cy="16" r="8" fill="#FF0000"/>
                    <path d="M24 10C26.2 10 28 11.8 28 14C28 16.2 26.2 18 24 18C21.8 18 20 16.2 20 14C20 11.8 21.8 10 24 10Z" fill="#FF9500"/>
                  </svg>
                </div>
                {/* Visa */}
                <div className="bg-white rounded px-3 py-1">
                  <svg className="h-5 w-auto" viewBox="0 0 48 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20.1 1.2L16.9 14.8H13.5L16.7 1.2H20.1ZM32.8 10.1L34.9 4.8L36.1 10.1H32.8ZM37.2 14.8H40.4L37.6 1.2H34.7C34.1 1.2 33.6 1.6 33.4 2.1L28.5 14.8H32.1L32.9 12.7H37.3L37.8 14.8H37.2ZM28.1 10C28.1 6.7 23.8 6.5 23.8 5C23.8 4.5 24.3 4 25.4 3.9C26 3.9 27.5 4 29.1 4.7L29.7 2C28.8 1.6 27.7 1.2 26.4 1.2C23 1.2 20.6 2.9 20.6 5.3C20.6 7 22.1 7.9 23.2 8.5C24.4 9.1 24.8 9.5 24.8 9.9C24.8 10.6 24 10.9 23.2 10.9C21.7 10.9 20.9 10.6 19.7 10.1L19.1 12.4C20.3 12.9 21.7 13.3 23.1 13.3C26.7 13.4 29.1 11.7 29.1 9.2L28.1 10ZM14.2 1.2L9.2 14.8H5.6L3.1 3.6C2.9 2.9 2.8 2.6 2.3 2.3C1.5 1.8 0.2 1.3 -1 1L-0.9 0.7H4.8C5.6 0.7 6.3 1.2 6.5 2.1L8 10.1L11.7 1.2H14.2Z" fill="#1434CB"/>
                  </svg>
                </div>
                {/* Apple Pay */}
                <div className="bg-black rounded px-3 py-2">
                  <svg className="h-4 w-auto" viewBox="0 0 48 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8.5 3C7.8 3.8 6.8 4.4 5.8 4.3C5.7 3.3 6.1 2.2 6.8 1.5C7.5 0.7 8.6 0.1 9.5 0C9.6 1 9.3 2.1 8.5 3ZM9.5 4.6C7.8 4.5 6.4 5.6 5.6 5.6C4.8 5.6 3.6 4.7 2.3 4.7C0.6 4.8 -1 5.8 -1.9 7.4C-3.7 10.6 -2.3 15.3 -0.6 17.9C0.2 19.1 1.2 20.5 2.5 20.5C3.8 20.4 4.2 19.7 5.7 19.7C7.2 19.7 7.6 20.5 8.9 20.5C10.3 20.5 11.2 19.2 12 18C12.9 16.7 13.3 15.4 13.3 15.4C13.3 15.4 10.9 14.5 10.9 11.7C10.9 9.3 12.8 8.2 12.9 8.1C11.7 6.4 9.9 6.2 9.3 6.2L9.5 4.6Z" fill="white"/>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
