"use client";

import { useState, useEffect, Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { MapPin, X, AlertCircle, Check } from 'lucide-react';
import { useLanguage } from '../lib/contexts/LanguageContext';
import { loadTranslation } from '../lib/i18n';

export default function DeliveryZoneCheck() {
  const [isOpen, setIsOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [hasChecked, setHasChecked] = useState(false);
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string) => k);

  useEffect(() => {
    // Проверяем, проверял ли пользователь адрес ранее
    const checkedBefore = localStorage.getItem('deliveryZoneChecked');
    if (!checkedBefore) {
      // Показываем модалку через 3 секунды после загрузки
      const timer = setTimeout(() => {
        setIsOpen(true);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    };

    loadTranslations();
  }, [language]);

  const checkDeliveryZone = async () => {
    if (!address.trim()) {
      alert(t('delivery_check.alert_address', 'Введите адрес'));
      return;
    }

    setChecking(true);
    setResult(null);

    try {
      const response = await fetch('/api/delivery/check-zone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address })
      });

      const data = await response.json();
      setResult(data);
      setHasChecked(true);

      // Сохраняем что пользователь проверил адрес
      localStorage.setItem('deliveryZoneChecked', 'true');
      if (data.success && data.canDeliver) {
        // Сохраняем адрес для последующего использования
        localStorage.setItem('userAddress', address);
      }
    } catch (error) {
      console.error('Error:', error);
      setResult({
        success: false,
        error: t('delivery_check.error', 'Ошибка проверки адреса')
      });
    } finally {
      setChecking(false);
    }
  };

  const handleClose = () => {
    if (hasChecked) {
      setIsOpen(false);
    }
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={handleClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-50" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white shadow-xl transition-all">
                <div className="relative">
                  {hasChecked && (
                    <button
                      onClick={handleClose}
                      className="absolute top-4 right-4 z-10 text-gray-400 hover:text-gray-600"
                    >
                      <X className="h-6 w-6" />
                    </button>
                  )}

                  <div className="p-6">
                    <div className="flex items-center justify-center w-16 h-16 mx-auto mb-4 rounded-full bg-primary-100">
                      <MapPin className="h-8 w-8 text-primary-600" />
                    </div>

                    <Dialog.Title className="text-2xl font-bold text-center mb-2">
                      {t('delivery_check.title', 'Проверьте зону доставки')}
                    </Dialog.Title>

                    <p className="text-center text-gray-600 mb-6">
                      {t('delivery_check.subtitle', 'Введите ваш адрес, чтобы узнать, доставляем ли мы к вам')}
                    </p>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium mb-2">
                          {t('delivery_check.address_label', 'Ваш адрес')}
                        </label>
                        <input
                          type="text"
                          value={address}
                          onChange={(e) => setAddress(e.target.value)}
                          placeholder={t('delivery_check.address_placeholder', 'Kurhausstraße 11A, 97688 Bad Kissingen')}
                          className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-primary-500"
                          onKeyPress={(e) => e.key === 'Enter' && checkDeliveryZone()}
                        />
                      </div>

                      <button
                        onClick={checkDeliveryZone}
                        disabled={checking}
                        className="w-full bg-primary-600 text-white py-3 rounded-lg hover:bg-primary-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
                      >
                        {checking ? t('delivery_check.checking', 'Проверка...') : t('delivery_check.check', 'Проверить адрес')}
                      </button>

                      {result && (
                        <div className={`p-4 rounded-lg ${
                          result.canDeliver 
                            ? 'bg-green-50 border-2 border-green-200' 
                            : 'bg-red-50 border-2 border-red-200'
                        }`}>
                          <div className="flex items-start">
                            <div className="flex-shrink-0">
                              {result.canDeliver ? (
                                <Check className="h-6 w-6 text-green-600" />
                              ) : (
                                <AlertCircle className="h-6 w-6 text-red-600" />
                              )}
                            </div>
                            <div className="ml-3">
                              <h3 className={`text-lg font-semibold ${
                                result.canDeliver ? 'text-green-900' : 'text-red-900'
                              }`}>
                                {result.canDeliver 
                                  ? t('delivery_check.available', '✓ Доставка доступна!') 
                                  : t('delivery_check.unavailable', '✗ Доставка недоступна')}
                              </h3>
                              <div className={`mt-2 text-sm ${
                                result.canDeliver ? 'text-green-700' : 'text-red-700'
                              }`}>
                                {result.canDeliver ? (
                                  <>
                                    <p className="mb-2">
                                      <strong>{t('delivery_check.zone', 'Зона')}:</strong> {result.zone?.name}
                                    </p>
                                    <p className="mb-2">
                                      <strong>{t('delivery_check.distance', 'Расстояние')}:</strong> {result.distance?.toFixed(1)} {t('delivery_check.km', 'км')}
                                    </p>
                                    <p className="mb-2">
                                      <strong>{t('delivery_check.fee', 'Стоимость доставки')}:</strong> {result.zone?.deliveryFee?.toFixed(2)} €
                                    </p>
                                    <p>
                                      <strong>{t('delivery_check.min_order', 'Минимальный заказ')}:</strong> {result.zone?.minOrderAmount?.toFixed(2)} €
                                    </p>
                                  </>
                                ) : (
                                  <>
                                    <p className="mb-2">
                                      {t('delivery_check.outside', 'К сожалению, ваш адрес находится вне зоны нашей доставки')} 
                                      {result.distance && ` (${result.distance.toFixed(1)} ${t('delivery_check.km', 'км')})`}.
                                    </p>
                                    <p className="font-semibold">
                                      {t('delivery_check.pickup', 'Вы можете заказать пиццу на самовывоз!')}
                                    </p>
                                    <p className="mt-2 text-xs">
                                      {t('delivery_check.our_address', 'Наш адрес')}: Kurhausstraße 11A, 97688 Bad Kissingen
                                    </p>
                                  </>
                                )}
                              </div>

                              {result.canDeliver && (
                                <button
                                  onClick={handleClose}
                                  className="mt-4 w-full bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 transition-colors font-medium"
                                >
                                  {t('delivery_check.continue', 'Отлично, продолжить покупки!')}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {!hasChecked && (
                        <p className="text-xs text-center text-gray-500">
                          {t('delivery_check.max_distance', 'Максимальное расстояние доставки: 15 км')}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}


