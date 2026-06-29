"use client";

import { useEffect, useState } from 'react';
import { Save, Store, CreditCard, Search, Globe, Mail, MapPin, Plug, MessageCircle } from 'lucide-react';
import StatusModal from '../../../components/admin/StatusModal';
import { normalizeStoredOrdersTime } from '../../../lib/order-acceptance-hours';

export default function SettingsPage() {
  const [mewsPosEnabled, setMewsPosEnabled] = useState(false);
  const [mewsLoading, setMewsLoading] = useState(true);
  const [mewsSaving, setMewsSaving] = useState(false);
  const [mewsError, setMewsError] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ open: boolean; title?: string; message: string }>({
    open: false,
    title: undefined,
    message: ''
  });
  const [settings, setSettings] = useState({
    // Store settings
    storeName: 'Dumbos Pizza',
    phone: '0971 72730',
    email: 'info@dumbospizza.de',
    address: 'Kurhausstraße 11A, 97688 Bad Kissingen',
    currency: 'EUR',
    minOrderAmount: 10,
    deliveryTime: '30-60',
    deliverySlotStart: '17:00',
    deliverySlotEnd: '21:30',
    deliverySlotStepMinutes: 5,

    // Order acceptance settings (HH:mm, как слоты доставки)
    ordersStartHour: '17:00',
    ordersEndHour: '21:30',
    ordersTimeZone: 'Europe/Berlin',
    ordersClosedReason: 'Заказы принимаются с 17:00.',
    ordersClosedMessageBeforeOpen: 'Мы откроем в {time}',
    ordersClosedMessageAfterClose: 'Мы закрыты, вернемся к вам завтра.',
    ordersBlockedUntil: '',
    ordersBlockedReason: 'Кухня переполнена. Попробуйте позже.',
    ordersBlockMinutes: 0,
    
    // Stripe settings
    stripePublicKey: '',
    stripeSecretKey: '',
    stripeWebhookSecret: '',

    // Telegram bot settings
    telegramBotToken: '',
    telegramChatId: '',
    telegramWebhookSecret: '',

    // WhatsApp order status: Web worker (no Meta) or Meta Cloud API
    whatsappOrderNotificationsEnabled: false,
    whatsappUseWebWorker: true,
    whatsappWebWorkerSecret: '',
    whatsappPhoneNumberId: '',
    whatsappAccessToken: '',
    whatsappDefaultCountryCode: '49',

    // Google Maps API
    googleMapsApiKey: '',
    
    // SEO settings
    metaTitle: 'Dumbos Pizza | Pizza bestellen in Bad Kissingen',
    metaDescription: 'Bestellen Sie leckere Pizza in Bad Kissingen. Schnelle Lieferung, große Auswahl',
    metaKeywords: 'Pizza bestellen Bad Kissingen, Lieferservice 97688, Pizza online bestellen',
    
    // Contact settings
    contactEmail: 'info@dumbospizza.de',
    supportPhone: '0971 72730',
    whatsapp: '+49 171 1234567',
    
    // Social media
    facebook: '',
    instagram: '',
    telegram: ''
  });

  useEffect(() => {
    const loadMewsSetting = async () => {
      try {
        setMewsLoading(true);
        const response = await fetch('/api/settings/mews-pos');
        const data = await response.json();
        if (data.success) {
          setMewsPosEnabled(Boolean(data.enabled));
        } else {
          setMewsError(data.error || 'Не удалось загрузить статус Mews POS');
        }
      } catch (error: any) {
        setMewsError(error.message || 'Ошибка загрузки статуса Mews POS');
      } finally {
        setMewsLoading(false);
      }
    };

    loadMewsSetting();
  }, []);

  useEffect(() => {
    const loadStoreSettings = async () => {
      try {
        const response = await fetch('/api/settings/store');
        const data = await response.json();
        if (data.success && data.settings) {
          const s = data.settings;
          setSettings((prev) => ({
            ...prev,
            ...s,
            ordersStartHour: normalizeStoredOrdersTime(s.ordersStartHour, 16),
            ordersEndHour: normalizeStoredOrdersTime(s.ordersEndHour, 22),
          }));
        }
      } catch (error: any) {
        console.error('Error loading store settings:', error);
      }
    };

    loadStoreSettings();
  }, []);

  const updateMewsSetting = async (enabled: boolean) => {
    try {
      setMewsSaving(true);
      setMewsError(null);
      const response = await fetch('/api/settings/mews-pos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Не удалось обновить настройку');
      }
      setMewsPosEnabled(Boolean(data.enabled));
    } catch (error: any) {
      setMewsError(error.message || 'Ошибка сохранения настройки');
    } finally {
      setMewsSaving(false);
    }
  };

  const saveStoreSettings = async (nextSettings: typeof settings) => {
    try {
      setSettingsSaving(true);
      setSettingsError(null);
      const response = await fetch('/api/settings/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextSettings)
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Не удалось сохранить настройки');
      }
      setModal({ open: true, title: 'Готово', message: 'Настройки сохранены!' });
      setSettings(nextSettings);
    } catch (error: any) {
      setSettingsError(error.message || 'Ошибка сохранения настроек');
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleSave = async () => {
    await saveStoreSettings(settings);
  };

  const applyKitchenBlockMinutes = async () => {
    const minutes = Number(settings.ordersBlockMinutes || 0);
    const nextSettings = { ...settings };
    if (!minutes || minutes <= 0) {
      nextSettings.ordersBlockedUntil = '';
    } else {
      nextSettings.ordersBlockedUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    }
    await saveStoreSettings(nextSettings);
  };

  const clearKitchenBlock = async () => {
    const nextSettings = { ...settings, ordersBlockedUntil: '' };
    await saveStoreSettings(nextSettings);
  };

  return (
    <div className="space-y-6">
      <StatusModal
        open={modal.open}
        title={modal.title}
        message={modal.message}
        onClose={() => setModal({ open: false, title: undefined, message: '' })}
      />
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Настройки</h1>
        <button
          onClick={handleSave}
          className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 flex items-center disabled:opacity-60"
          disabled={settingsSaving}
        >
          <Save className="h-5 w-5 mr-2" />
          {settingsSaving ? 'Сохранение...' : 'Сохранить все'}
        </button>
      </div>

      {settingsError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
          {settingsError}
        </div>
      )}

      <div className="grid grid-cols-12 gap-6">
        {/* Mews POS Toggle */}
        <div className="col-span-12">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center mb-6">
              <Plug className="h-6 w-6 text-primary-600 mr-3" />
              <h2 className="text-xl font-bold">Mews POS</h2>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Источник товаров и категорий</p>
                <p className="text-sm text-gray-500">
                  {mewsPosEnabled ? 'Mews POS включен' : 'Локальные товары (без POS)'}
                </p>
              </div>
              <button
                type="button"
                disabled={mewsLoading || mewsSaving}
                onClick={() => updateMewsSetting(!mewsPosEnabled)}
                className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                  mewsPosEnabled ? 'bg-primary-600' : 'bg-gray-300'
                } ${mewsLoading || mewsSaving ? 'opacity-60 cursor-not-allowed' : ''}`}
                aria-pressed={mewsPosEnabled}
              >
                <span
                  className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                    mewsPosEnabled ? 'translate-x-7' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            {mewsError && (
              <p className="text-sm text-red-600 mt-3">{mewsError}</p>
            )}
            {mewsSaving && (
              <p className="text-sm text-gray-500 mt-2">Сохраняю...</p>
            )}
          </div>
        </div>

        {/* Store Settings */}
        <div className="col-span-12 lg:col-span-6">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center mb-6">
              <Store className="h-6 w-6 text-primary-600 mr-3" />
              <h2 className="text-xl font-bold">Информация о магазине</h2>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Название магазина</label>
                <input
                  type="text"
                  value={settings.storeName}
                  onChange={(e) => setSettings({...settings, storeName: e.target.value})}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Телефон</label>
                <input
                  type="text"
                  value={settings.phone}
                  onChange={(e) => setSettings({...settings, phone: e.target.value})}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Email</label>
                <input
                  type="email"
                  value={settings.email}
                  onChange={(e) => setSettings({...settings, email: e.target.value})}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Адрес</label>
                <input
                  type="text"
                  value={settings.address}
                  onChange={(e) => setSettings({...settings, address: e.target.value})}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Валюта</label>
                  <select
                    value={settings.currency}
                    onChange={(e) => setSettings({...settings, currency: e.target.value})}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="EUR">EUR (€)</option>
                    <option value="USD">USD ($)</option>
                    <option value="GBP">GBP (£)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Мин. сумма заказа (€)</label>
                  <input
                    type="number"
                    value={settings.minOrderAmount}
                    onChange={(e) => setSettings({...settings, minOrderAmount: Number(e.target.value)})}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Время доставки (мин)</label>
                  <input
                    type="text"
                    value={settings.deliveryTime}
                    onChange={(e) => setSettings({...settings, deliveryTime: e.target.value})}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Order Acceptance Settings */}
        <div className="col-span-12 lg:col-span-6">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center mb-6">
              <Store className="h-6 w-6 text-primary-600 mr-3" />
              <h2 className="text-xl font-bold">Прием заказов</h2>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Заказы принимаются с (HH:mm)</label>
                  <input
                    type="time"
                    value={String(settings.ordersStartHour)}
                    onChange={(e) => setSettings({ ...settings, ordersStartHour: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Заказы принимаются до (HH:mm)</label>
                  <input
                    type="time"
                    value={String(settings.ordersEndHour)}
                    onChange={(e) => setSettings({ ...settings, ordersEndHour: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Временная зона</label>
                  <input
                    type="text"
                    value={settings.ordersTimeZone}
                    onChange={(e) => setSettings({ ...settings, ordersTimeZone: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="Europe/Berlin"
                  />
                </div>
              </div>

              <div className="border-t pt-4 mt-4">
                <p className="text-sm font-medium mb-2">Время доставки для выбора клиентом (слоты)</p>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">С (HH:mm)</label>
                    <input
                      type="time"
                      value={settings.deliverySlotStart}
                      onChange={(e) => setSettings({ ...settings, deliverySlotStart: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">До (HH:mm)</label>
                    <input
                      type="time"
                      value={settings.deliverySlotEnd}
                      onChange={(e) => setSettings({ ...settings, deliverySlotEnd: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Шаг (минут)</label>
                    <input
                      type="number"
                      min={5}
                      max={60}
                      step={5}
                      value={settings.deliverySlotStepMinutes}
                      onChange={(e) => setSettings({ ...settings, deliverySlotStepMinutes: Number(e.target.value) })}
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Сообщение до открытия</label>
                <input
                  type="text"
                  value={settings.ordersClosedMessageBeforeOpen}
                  onChange={(e) => setSettings({ ...settings, ordersClosedMessageBeforeOpen: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Сообщение после закрытия</label>
                <input
                  type="text"
                  value={settings.ordersClosedMessageAfterClose}
                  onChange={(e) => setSettings({ ...settings, ordersClosedMessageAfterClose: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Сообщение при перегрузке кухни</label>
                <input
                  type="text"
                  value={settings.ordersBlockedReason}
                  onChange={(e) => setSettings({ ...settings, ordersBlockedReason: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-4 items-end">
                <div className="col-span-1">
                  <label className="block text-sm font-medium mb-2">Блок на минут</label>
                  <input
                    type="number"
                    min={0}
                    value={settings.ordersBlockMinutes}
                    onChange={(e) => setSettings({ ...settings, ordersBlockMinutes: Number(e.target.value) })}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div className="col-span-2 flex gap-2">
                  <button
                    type="button"
                    onClick={applyKitchenBlockMinutes}
                    className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700"
                  >
                    Установить блокировку
                  </button>
                  <button
                    type="button"
                    onClick={clearKitchenBlock}
                    className="border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50"
                  >
                    Снять блокировку
                  </button>
                </div>
              </div>

              {settings.ordersBlockedUntil && (
                <div className="text-sm text-gray-600">
                  Блок активен до:{' '}
                  {new Date(settings.ordersBlockedUntil).toLocaleString('de-DE')}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Stripe Payment Settings */}
        <div className="col-span-12 lg:col-span-6">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center mb-6">
              <CreditCard className="h-6 w-6 text-primary-600 mr-3" />
              <h2 className="text-xl font-bold">Stripe платежи</h2>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Publishable Key</label>
                <input
                  type="text"
                  value={settings.stripePublicKey}
                  onChange={(e) => setSettings({...settings, stripePublicKey: e.target.value})}
                  placeholder="pk_live_..."
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Secret Key</label>
                <input
                  type="password"
                  value={settings.stripeSecretKey}
                  onChange={(e) => setSettings({...settings, stripeSecretKey: e.target.value})}
                  placeholder="sk_live_..."
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">Храните в безопасности, не делитесь</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Webhook Secret</label>
                <input
                  type="password"
                  value={settings.stripeWebhookSecret}
                  onChange={(e) => setSettings({...settings, stripeWebhookSecret: e.target.value})}
                  placeholder="whsec_..."
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                />
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
                <p className="text-sm text-blue-800">
                  <strong>Как настроить Stripe:</strong><br/>
                  1. Зарегистрируйтесь на stripe.com<br/>
                  2. Получите API ключи в разделе Developers<br/>
                  3. Настройте webhook на /api/stripe/webhook<br/>
                  4. Включите Apple Pay и Google Pay
                </p>
              </div>
            </div>
          </div>

          {/* Telegram Bot Settings */}
          <div className="bg-white rounded-lg shadow-sm p-6 mt-6">
            <div className="flex items-center mb-6">
              <Globe className="h-6 w-6 text-primary-600 mr-3" />
              <h2 className="text-xl font-bold">Telegram бот</h2>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Bot Token</label>
                <input
                  type="password"
                  value={settings.telegramBotToken}
                  onChange={(e) => setSettings({ ...settings, telegramBotToken: e.target.value })}
                  placeholder="123456:ABC-DEF..."
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Chat ID</label>
                <input
                  type="text"
                  value={settings.telegramChatId}
                  onChange={(e) => setSettings({ ...settings, telegramChatId: e.target.value })}
                  placeholder="-1001234567890"
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Webhook Secret</label>
                <input
                  type="password"
                  value={settings.telegramWebhookSecret}
                  onChange={(e) => setSettings({ ...settings, telegramWebhookSecret: e.target.value })}
                  placeholder="your_webhook_secret"
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                />
              </div>
            </div>
          </div>

          {/* WhatsApp order status notifications */}
          <div className="bg-white rounded-lg shadow-sm p-6 mt-6">
            <div className="flex items-center mb-6">
              <MessageCircle className="h-6 w-6 text-primary-600 mr-3" />
              <h2 className="text-xl font-bold">Уведомления WhatsApp</h2>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="whatsappOrderNotificationsEnabled"
                  checked={!!settings.whatsappOrderNotificationsEnabled}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      whatsappOrderNotificationsEnabled: e.target.checked
                    })
                  }
                  className="rounded border-gray-300"
                />
                <label htmlFor="whatsappOrderNotificationsEnabled" className="text-sm font-medium">
                  Отправлять клиенту статус заказа в WhatsApp
                </label>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="whatsappUseWebWorker"
                  checked={!!settings.whatsappUseWebWorker}
                  onChange={(e) =>
                    setSettings({ ...settings, whatsappUseWebWorker: e.target.checked })
                  }
                  className="rounded border-gray-300"
                />
                <label htmlFor="whatsappUseWebWorker" className="text-sm font-medium">
                  Использовать WhatsApp Web (без Meta: один раз QR, дальше просто отправка)
                </label>
              </div>

              {settings.whatsappUseWebWorker && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-2">Секрет (должен совпадать с .env на ПК воркера)</label>
                    <input
                      type="password"
                      value={settings.whatsappWebWorkerSecret ?? ''}
                      onChange={(e) =>
                        setSettings({ ...settings, whatsappWebWorkerSecret: e.target.value })
                      }
                      placeholder="или WHATSAPP_WEB_WORKER_SECRET в .env на сервере"
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                    />
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <p className="text-sm text-green-800">
                      <strong>Воркер опрашивает сайт</strong> (исходящее соединение с ПК). Подходит когда ПК за NAT: сайт не может до вас достучаться. На ПК с воркером в .env: <code className="bg-green-100 px-1 rounded">API_BASE_URL=https://ваш-сайт.de</code>, <code className="bg-green-100 px-1 rounded">WHATSAPP_WEB_WORKER_SECRET=тот_же_секрет</code>. Запуск: <code className="bg-green-100 px-1 rounded">npm run whatsapp-worker</code>. Один раз QR, далее держите процесс запущенным.
                    </p>
                  </div>
                </>
              )}

              {!settings.whatsappUseWebWorker && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-2">Phone Number ID (Meta)</label>
                    <input
                      type="text"
                      value={settings.whatsappPhoneNumberId ?? ''}
                      onChange={(e) =>
                        setSettings({ ...settings, whatsappPhoneNumberId: e.target.value })
                      }
                      placeholder="или WHATSAPP_PHONE_NUMBER_ID в .env"
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Access Token (Meta)</label>
                    <input
                      type="password"
                      value={settings.whatsappAccessToken ?? ''}
                      onChange={(e) =>
                        setSettings({ ...settings, whatsappAccessToken: e.target.value })
                      }
                      placeholder="или WHATSAPP_ACCESS_TOKEN в .env"
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Код страны по умолчанию</label>
                    <input
                      type="text"
                      value={settings.whatsappDefaultCountryCode ?? '49'}
                      onChange={(e) =>
                        setSettings({ ...settings, whatsappDefaultCountryCode: e.target.value })
                      }
                      placeholder="49"
                      className="w-full max-w-[120px] px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                    />
                  </div>
                  <p className="text-xs text-gray-500">Шаблон: <code className="bg-gray-100 px-1 rounded">node scripts/create-whatsapp-template.js</code> (см. docs/WHATSAPP_SETUP.md)</p>
                </>
              )}
            </div>
          </div>

          {/* Google Maps API */}
          <div className="bg-white rounded-lg shadow-sm p-6 mt-6">
            <div className="flex items-center mb-6">
              <MapPin className="h-6 w-6 text-primary-600 mr-3" />
              <h2 className="text-xl font-bold">Google Maps API</h2>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">API Key</label>
                <input
                  type="text"
                  value={settings.googleMapsApiKey}
                  onChange={(e) => setSettings({...settings, googleMapsApiKey: e.target.value})}
                  placeholder="AIza..."
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">Для проверки зон доставки</p>
              </div>

              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm text-green-800">
                  <strong>Как получить Google Maps API Key:</strong><br/>
                  1. Перейдите на console.cloud.google.com<br/>
                  2. Создайте проект или выберите существующий<br/>
                  3. Включите &quot;Geocoding API&quot; и &quot;Distance Matrix API&quot;<br/>
                  4. Создайте API ключ в разделе Credentials<br/>
                  5. Ограничьте ключ по домену для безопасности
                </p>
              </div>
            </div>
          </div>

          {/* Contact Settings */}
          <div className="bg-white rounded-lg shadow-sm p-6 mt-6">
            <div className="flex items-center mb-6">
              <Mail className="h-6 w-6 text-primary-600 mr-3" />
              <h2 className="text-xl font-bold">Контакты</h2>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Email поддержки</label>
                <input
                  type="email"
                  value={settings.contactEmail}
                  onChange={(e) => setSettings({...settings, contactEmail: e.target.value})}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Телефон поддержки</label>
                <input
                  type="text"
                  value={settings.supportPhone}
                  onChange={(e) => setSettings({...settings, supportPhone: e.target.value})}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">WhatsApp</label>
                <input
                  type="text"
                  value={settings.whatsapp}
                  onChange={(e) => setSettings({...settings, whatsapp: e.target.value})}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="+49 171 1234567"
                />
              </div>
            </div>
          </div>
        </div>

        {/* SEO Settings */}
        <div className="col-span-12">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center mb-6">
              <Search className="h-6 w-6 text-primary-600 mr-3" />
              <h2 className="text-xl font-bold">SEO настройки</h2>
            </div>
            
            <div className="grid grid-cols-12 gap-6">
              <div className="col-span-12">
                <label className="block text-sm font-medium mb-2">Meta Title</label>
                <input
                  type="text"
                  value={settings.metaTitle}
                  onChange={(e) => setSettings({...settings, metaTitle: e.target.value})}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  maxLength={60}
                />
                <p className="text-xs text-gray-500 mt-1">{settings.metaTitle.length}/60 символов</p>
              </div>

              <div className="col-span-12">
                <label className="block text-sm font-medium mb-2">Meta Description</label>
                <textarea
                  value={settings.metaDescription}
                  onChange={(e) => setSettings({...settings, metaDescription: e.target.value})}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  rows={3}
                  maxLength={160}
                />
                <p className="text-xs text-gray-500 mt-1">{settings.metaDescription.length}/160 символов</p>
              </div>

              <div className="col-span-12">
                <label className="block text-sm font-medium mb-2">Meta Keywords (через запятую)</label>
                <textarea
                  value={settings.metaKeywords}
                  onChange={(e) => setSettings({...settings, metaKeywords: e.target.value})}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  rows={3}
                  placeholder="pizza, lieferservice, bad kissingen, pizza bestellen"
                />
                <p className="text-xs text-gray-500 mt-1">Рекомендуется 5-10 ключевых слов</p>
              </div>
            </div>
          </div>
        </div>

        {/* Social Media */}
        <div className="col-span-12">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center mb-6">
              <Globe className="h-6 w-6 text-primary-600 mr-3" />
              <h2 className="text-xl font-bold">Социальные сети</h2>
            </div>
            
            <div className="grid grid-cols-12 gap-6">
              <div className="col-span-12 lg:col-span-4">
                <label className="block text-sm font-medium mb-2">Facebook</label>
                <input
                  type="url"
                  value={settings.facebook}
                  onChange={(e) => setSettings({...settings, facebook: e.target.value})}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="https://facebook.com/yourpage"
                />
              </div>

              <div className="col-span-12 lg:col-span-4">
                <label className="block text-sm font-medium mb-2">Instagram</label>
                <input
                  type="url"
                  value={settings.instagram}
                  onChange={(e) => setSettings({...settings, instagram: e.target.value})}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="https://instagram.com/yourpage"
                />
              </div>

              <div className="col-span-12 lg:col-span-4">
                <label className="block text-sm font-medium mb-2">Telegram</label>
                <input
                  type="text"
                  value={settings.telegram}
                  onChange={(e) => setSettings({...settings, telegram: e.target.value})}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="@yourbot"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
