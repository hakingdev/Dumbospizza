"use client";

import { useEffect, useState } from 'react';
import { useLanguage } from '../../../lib/contexts/LanguageContext';
import { loadTranslation } from '../../../lib/i18n';

export default function DeliveryPage() {
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string) => k);
  const [zones, setZones] = useState<any[]>([]);

  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    };

    loadTranslations();
  }, [language]);

  useEffect(() => {
    const loadZones = async () => {
      try {
        const response = await fetch('/api/delivery-zones');
        const data = await response.json();
        if (data.success) {
          setZones(data.zones || []);
        }
      } catch (error) {
        console.error('Error loading delivery zones:', error);
      }
    };

    loadZones();
  }, []);

  return (
    <div className="container mx-auto px-4 py-12">
      <h1 className="text-4xl font-bold mb-8">{t('delivery_page.title', 'Зоны доставки')}</h1>
      
      <div className="grid md:grid-cols-2 gap-8">
        {zones.map((zone) => (
          <div key={zone._id} className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="text-2xl font-bold mb-4">{zone.name}</h2>
            <p className="text-gray-600 mb-2">
              {t('delivery_page.min_order', 'Минимальный заказ')}: <strong>{zone.minOrderAmount}€</strong>
            </p>
            <p className="text-gray-600 mb-2">
              {t('delivery_page.fee', 'Доставка')}:{" "}
              {zone.deliveryFee > 0 ? (
                <strong>{zone.deliveryFee}€</strong>
              ) : (
                <strong className="text-green-600">{t('delivery_page.free', 'Бесплатно')}</strong>
              )}
            </p>
            <p className="text-gray-600">
              {t('delivery_page.distance', 'Расстояние')}: {t('delivery_page.up_to', 'до')} {zone.maxDistance}{" "}
              {t('delivery_check.km', 'км')}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-12 bg-primary-50 rounded-2xl p-8">
        <h2 className="text-2xl font-bold mb-4">{t('delivery_page.time_title', 'Время доставки')}</h2>
        <p className="text-lg text-gray-700 mb-4">
          {t('delivery_page.time_avg', 'Среднее время доставки')}: <strong>30-45 {t('hero.minutes', 'минут')}</strong>
        </p>
        <p className="text-gray-600">
          {t('delivery_page.free_text', 'Бесплатная доставка при заказе от 30€ в центр города.')}
        </p>
      </div>
    </div>
  );
}

