"use client";

import { useEffect, useState } from 'react';
import { useLanguage } from '../../../lib/contexts/LanguageContext';
import { loadTranslation } from '../../../lib/i18n';

const DEFAULT_STORE_INFO = {
  address: 'Kurhausstraße 11A, 97688 Bad Kissingen',
  phone: '022 210-210'
};

export default function AboutPage() {
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string) => k);
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
      <h1 className="text-4xl font-bold mb-8">{t('about.title', 'О нас')}</h1>
      
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl p-8 shadow-sm mb-8">
          <h2 className="text-2xl font-bold mb-4">{t('about.company', '🍕 Dumbo Slice Pizza (Dumbos Pizza) — Bad Kissingen')}</h2>
          <p className="text-lg text-gray-700 mb-4">
            {t('about.intro', 'Мы — команда профессионалов, которые по-настоящему любят пиццу и хотят делиться этой любовью с вами!')}
          </p>
          <p className="text-gray-600 mb-4">
            {t('about.history', 'Начинаем нашу историю в 2026 году и приглашаем вас стать частью нашего пути в Бад-Киссингене и окрестностях. Наша миссия — завоевать ваше доверие, предлагая сервис и вкус, достойные лучших итальянских заведений.')}
          </p>
          <p className="text-gray-600">
            {t('about.ingredients', 'В работе мы используем только свежие ингредиенты высшего качества и следуем традиционным рецептам итальянской кухни.')}
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
            <div className="text-4xl mb-3">🍕</div>
            <h3 className="font-bold text-xl mb-2">{t('about.stats.pizzas_title', '18+ видов пицц')}</h3>
            <p className="text-gray-600">{t('about.stats.pizzas_text', 'На любой вкус')}</p>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
            <div className="text-4xl mb-3">⏱️</div>
            <h3 className="font-bold text-xl mb-2">{t('about.stats.time_title', '30-60 минут')}</h3>
            <p className="text-gray-600">{t('about.stats.time_text', 'Быстрая доставка')}</p>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
            <div className="text-4xl mb-3">⭐</div>
            <h3 className="font-bold text-xl mb-2">{t('about.stats.rating_title', '4.8 рейтинг')}</h3>
            <p className="text-gray-600">{t('about.stats.rating_text', 'От наших клиентов')}</p>
          </div>
        </div>

        <div className="bg-primary-600 text-white rounded-2xl p-8 text-center">
          <h2 className="text-3xl font-bold mb-4">{t('about.contact_title', 'Свяжитесь с нами')}</h2>
          <p className="text-xl mb-2">📞 {storeInfo.phone}</p>
          <p className="text-lg">📍 {storeInfo.address}</p>
        </div>
      </div>
    </div>
  );
}
