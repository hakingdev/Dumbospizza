"use client";

import { useEffect, useState } from 'react';
import { useLanguage } from '../../../lib/contexts/LanguageContext';
import { loadTranslation } from '../../../lib/i18n';
import { DEFAULT_STORE_PHONE } from '../../../lib/store-phone';
import { NoTranslate } from '../../../components/NoTranslate';

const DEFAULT_STORE_INFO = {
  address: 'Kurhausstraße 11A, 97688 Bad Kissingen',
  phone: DEFAULT_STORE_PHONE
};

export default function AboutPage() {
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string, fallback?: string) => fallback ?? k);
  const [storeInfo, setStoreInfo] = useState(DEFAULT_STORE_INFO);

  useEffect(() => {
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
          const address = data.settings.address || DEFAULT_STORE_INFO.address;
          const phone = data.settings.phone || data.settings.supportPhone || DEFAULT_STORE_INFO.phone;
          setStoreInfo({ address, phone });
        }
      } catch (error) {
        console.error('Error loading store settings:', error);
      }
    };

    loadStoreSettings();
  }, []);

  return (
    <div className="container mx-auto px-4 py-12">
      <h1 className="text-4xl font-bold mb-8">{t('about.title', 'Über uns')}</h1>
      
      <div className="max-w-4xl mx-auto">
        <div className="mb-8 rounded-2xl bg-white p-6 shadow-sm sm:p-8">
          <h2 className="mb-4 break-words text-2xl font-bold leading-tight">{t('about.company', '🍕 Dumbo Slice Pizza (Dumbos Pizza) — Bad Kissingen')}</h2>
          <p className="text-lg text-gray-700 mb-4">
            {t('about.intro', 'Wir sind ein Team, das Pizza wirklich liebt und diese Leidenschaft mit Ihnen teilen möchte.')}
          </p>
          <p className="text-gray-600 mb-4">
            {t('about.history', 'Unsere Geschichte beginnt 2026. Wir laden Sie ein, Teil unseres Weges in Bad Kissingen und Umgebung zu werden. Unser Ziel ist Service und Geschmack, denen Sie vertrauen können.')}
          </p>
          <p className="text-gray-600">
            {t('about.ingredients', 'Wir arbeiten mit frischen Zutaten und orientieren uns an traditionellen Rezepten der italienischen Küche.')}
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
            <div className="text-4xl mb-3">🍕</div>
            <h3 className="font-bold text-xl mb-2">{t('about.stats.pizzas_title', '18+ Pizzasorten')}</h3>
            <p className="text-gray-600">{t('about.stats.pizzas_text', 'Für jeden Geschmack')}</p>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
            <div className="text-4xl mb-3">⏱️</div>
            <h3 className="font-bold text-xl mb-2">{t('about.stats.time_title', '30-60 Minuten')}</h3>
            <p className="text-gray-600">{t('about.stats.time_text', 'Schnelle Lieferung')}</p>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
            <div className="text-4xl mb-3">⭐</div>
            <h3 className="font-bold text-xl mb-2">{t('about.stats.rating_title', '4,8 Bewertung')}</h3>
            <p className="text-gray-600">{t('about.stats.rating_text', 'Von unseren Kunden')}</p>
          </div>
        </div>

        <div className="rounded-2xl bg-primary-600 p-6 text-center text-white sm:p-8">
          <h2 className="mb-4 break-words text-3xl font-bold leading-tight">{t('about.contact_title', 'Kontaktieren Sie uns')}</h2>
          <p className="mb-2 break-words text-xl leading-tight">📞 <NoTranslate>{storeInfo.phone}</NoTranslate></p>
          <p className="break-words text-lg leading-tight">📍 <NoTranslate>{storeInfo.address}</NoTranslate></p>
        </div>
      </div>
    </div>
  );
}
