"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '../../../lib/contexts/LanguageContext';
import { loadTranslation } from '../../../lib/i18n';

interface OrderStatusStep {
  status: string;
  label: string;
  description: string;
}

const getOrderStatusSteps = (t: (key: string, defaultValue?: string) => string): OrderStatusStep[] => [
  {
    status: 'new',
    label: t('track.order_status.new', 'Новый заказ'),
    description: t('track.status_description.new', 'Мы получили ваш заказ и скоро начнем готовить.')
  },
  {
    status: 'preparing',
    label: t('track.order_status.preparing', 'Готовится'),
    description: t('track.status_description.preparing', 'Наши повара готовят ваш заказ.')
  },
  {
    status: 'ready_for_delivery',
    label: t('track.order_status.ready_for_delivery', 'Готов к доставке'),
    description: t('track.status_description.ready_for_delivery', 'Ваш заказ готов и ожидает курьера.')
  },
  {
    status: 'delivering',
    label: t('track.order_status.delivering', 'В пути'),
    description: t('track.status_description.delivering', 'Курьер уже едет к вам с вашим заказом.')
  },
  {
    status: 'completed',
    label: t('track.order_status.completed', 'Доставлен'),
    description: t('track.status_description.completed', 'Ваш заказ был доставлен. Приятного аппетита!')
  }
];

export default function TrackOrderPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchType, setSearchType] = useState<'phone' | 'orderNumber'>('phone');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const router = useRouter();
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string) => k);

  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    };

    loadTranslations();
  }, [language]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!searchTerm) {
      setError(t('track.error_missing', 'Пожалуйста, введите номер телефона или номер заказа'));
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(
        `/api/orders?${searchType === 'phone' ? 'phoneNumber' : 'orderNumber'}=${encodeURIComponent(searchTerm)}`
      );
      
      if (!response.ok) {
        throw new Error(t('track.error_fetch', 'Не удалось найти заказы. Пожалуйста, проверьте данные и попробуйте снова.'));
      }
      
      const data = await response.json();
      
      if (data.orders.length === 0) {
        setError(t('track.error_not_found', 'Заказы не найдены. Пожалуйста, проверьте данные и попробуйте снова.'));
        setOrders([]);
      } else {
        setOrders(data.orders);
      }
    } catch (err: any) {
      setError(err.message || t('track.error_generic', 'Произошла ошибка при поиске заказа'));
      setOrders([]);
    } finally {
      setIsLoading(false);
    }
  };
  
  const orderStatusSteps = getOrderStatusSteps(t);
  const getOrderStatusIndex = (status: string) => {
    return orderStatusSteps.findIndex(step => step.status === status);
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6 text-center">{t('track.title', 'Отслеживание заказа')}</h1>
      
      <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
        <form onSubmit={handleSearch} className="space-y-4">
          <div className="flex flex-col space-y-2">
            <div className="flex space-x-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  name="searchType"
                  value="phone"
                  checked={searchType === 'phone'}
                  onChange={() => setSearchType('phone')}
                  className="mr-2"
                />
                <span>{t('track.search_by_phone', 'Номер телефона')}</span>
              </label>
              
              <label className="flex items-center">
                <input
                  type="radio"
                  name="searchType"
                  value="orderNumber"
                  checked={searchType === 'orderNumber'}
                  onChange={() => setSearchType('orderNumber')}
                  className="mr-2"
                />
                <span>{t('track.search_by_order', 'Номер заказа')}</span>
              </label>
            </div>
            
            <div className="relative">
              <input
                type={searchType === 'phone' ? 'tel' : 'text'}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={
                  searchType === 'phone' 
                    ? t('track.phone_placeholder', 'Введите номер телефона (например, +49123456789)') 
                    : t('track.order_placeholder', 'Введите номер заказа (например, 230901001)')
                }
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>
          
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-primary-600 hover:bg-primary-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors disabled:bg-gray-400"
          >
            {isLoading ? t('track.searching', 'Поиск...') : t('track.find_order', 'Найти заказ')}
          </button>
        </form>
        
        {error && (
          <div className="mt-4 p-3 bg-red-100 border border-red-200 text-red-700 rounded-lg">
            {error}
          </div>
        )}
      </div>
      
      {orders.length > 0 && (
        <div className="space-y-8">
          <h2 className="text-2xl font-semibold">{t('track.found_orders', 'Найденные заказы')}</h2>
          
          {orders.map(order => (
            <div key={order._id} className="bg-white rounded-lg shadow-lg overflow-hidden">
              <div className="p-6 border-b">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold text-xl mb-1">
                      {t('order', 'Заказ')} #{order.orderNumber}
                    </h3>
                    <p className="text-gray-500">
                      {new Date(order.createdAt).toLocaleDateString('de-DE', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="inline-block rounded-full px-3 py-1 text-sm font-semibold bg-blue-100 text-blue-800">
                      {t(`track.order_status.${order.status}`, 'Статус')}
                    </span>
                    <p className="mt-2 font-semibold text-xl">
                      {order.total.toFixed(2)} €
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Status progress bar */}
              <div className="p-6">
                <div className="relative">
                  <div className="overflow-hidden h-2 mb-4 text-xs flex rounded bg-gray-200">
                    <div 
                      className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-primary-500"
                      style={{ 
                        width: `${
                          order.status === 'cancelled' 
                            ? 0 
                            : (getOrderStatusIndex(order.status) + 1) / orderStatusSteps.length * 100
                        }%` 
                      }}
                    ></div>
                  </div>
                  
                  <div className="flex justify-between">
                    {orderStatusSteps.map((step, index) => {
                      const isCompleted = getOrderStatusIndex(order.status) >= index;
                      const isCurrent = getOrderStatusIndex(order.status) === index;
                      
                      return (
                        <div key={step.status} className="flex flex-col items-center w-1/5">
                          <div className={`
                            rounded-full h-8 w-8 flex items-center justify-center
                            ${isCompleted ? 'bg-primary-500 text-white' : 'bg-gray-200 text-gray-500'}
                            ${isCurrent ? 'ring-4 ring-primary-100' : ''}
                          `}>
                            {isCompleted ? (
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 0 1 0 1.414l-8 8a1 1 0 0 1-1.414 0l-4-4a1 1 0 1 1 1.414-1.414L8 12.586l7.293-7.293a1 1 0 0 1 1.414 0z" clipRule="evenodd" />
                              </svg>
                            ) : (
                              index + 1
                            )}
                          </div>
                          <div className="text-xs mt-1 text-center">{step.label}</div>
                        </div>
                      );
                    })}
                  </div>
                  
                  {/* Current status description */}
                  {order.status !== 'cancelled' && (
                    <div className="mt-4 p-3 bg-blue-50 rounded-lg text-center">
                      {orderStatusSteps[getOrderStatusIndex(order.status)]?.description || t('track.status_updating', 'Bestellstatus wird aktualisiert...')}
                    </div>
                  )}
                  
                  {order.status === 'cancelled' && (
                    <div className="mt-4 p-3 bg-red-50 rounded-lg text-center text-red-700">
                      {t('track.cancelled_message', 'Diese Bestellung wurde storniert. Kontaktieren Sie uns für weitere Informationen.')}
                    </div>
                  )}
                </div>
              </div>
              
              {/* Order details */}
              <div className="p-6 border-t border-gray-100">
                <h4 className="font-semibold mb-2">{t('confirmation.order_details', 'Bestelldetails')}</h4>
                <ul className="divide-y divide-gray-100">
                  {order.items.map((item: any, index: number) => (
                    <li key={index} className="py-2 flex justify-between">
                      <div>
                        <span className="font-medium">{item.name}</span>
                        {item.size && <span className="text-gray-500 ml-1">({item.size.name})</span>}
                        
                        {/* Display customizations */}
                        {(item.extras?.toppings?.length > 0 || 
                          item.extras?.sauces?.length > 0 || 
                          item.extras?.sides?.length > 0) && (
                          <ul className="text-sm text-gray-500 mt-1 ml-4">
                            {item.extras?.toppings?.map((topping: any, i: number) => (
                              <li key={`topping-${i}`}>+ {topping.name}</li>
                            ))}
                            
                            {item.extras?.sauces?.map((sauce: any, i: number) => (
                              <li key={`sauce-${i}`}>+ {sauce.name}</li>
                            ))}
                            
                            {item.extras?.sides?.map((side: any, i: number) => (
                              <li key={`side-${i}`}>+ {side.name}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="flex items-start">
                        <span className="text-gray-500 mr-2">{item.quantity} ×</span>
                        <span>{(item.price * item.quantity).toFixed(2)} €</span>
                      </div>
                    </li>
                  ))}
                </ul>
                
                {/* Order totals */}
                <div className="mt-4 border-t pt-4">
                  <div className="flex justify-between py-1">
                    <span className="text-gray-600">{t('cart.subtotal', 'Zwischensumme')}:</span>
                    <span>{order.subtotal.toFixed(2)} €</span>
                  </div>
                  
                  {order.deliveryFee > 0 && (
                    <div className="flex justify-between py-1">
                      <span className="text-gray-600">{t('cart.delivery_fee', 'Lieferung')}:</span>
                      <span>{order.deliveryFee.toFixed(2)} €</span>
                    </div>
                  )}
                  
                  {order.loyaltyPointsUsed > 0 && (
                    <div className="flex justify-between py-1">
                      <span className="text-gray-600">{t('checkout.discount_points', 'Rabatt (Punkte)')}:</span>
                      <span>-{(order.loyaltyPointsUsed / 100).toFixed(2)} €</span>
                    </div>
                  )}
                  
                  <div className="flex justify-between py-2 font-semibold text-lg border-t mt-2">
                    <span>{t('cart.total', 'Gesamt')}:</span>
                    <span>{order.total.toFixed(2)} €</span>
                  </div>
                </div>
              </div>
              
              {/* Order contact information */}
              {(order.customerName || order.phoneNumber || order.email || order.deliveryAddress || order.deliveryType === 'pickup') && (
                <div className="p-6 bg-gray-50 border-t border-gray-100">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(order.customerName || order.phoneNumber || order.email) && (
                      <div>
                        <h4 className="font-semibold mb-1">{t('confirmation.contact_info', 'Kontaktinformationen')}</h4>
                        {order.customerName && <p>{order.customerName}</p>}
                        {order.phoneNumber && <p>{order.phoneNumber}</p>}
                        {order.email && <p>{order.email}</p>}
                      </div>
                    )}

                    <div>
                    <h4 className="font-semibold mb-1">
                      {order.deliveryType === 'delivery' ? t('confirmation.delivery_address', 'Lieferadresse') : t('confirmation.pickup', 'Abholung')}
                    </h4>
                    {order.deliveryType === 'delivery' && order.deliveryAddress && (
                      <>
                        <p>
                          {order.deliveryAddress.street} {order.deliveryAddress.houseNumber}
                          {order.deliveryAddress.floor && `, ${t('checkout.floor', 'Etage / Wohnung')} ${order.deliveryAddress.floor}`}
                        </p>
                        <p>{order.deliveryAddress.postalCode} {order.deliveryAddress.city}</p>
                        {order.deliveryAddress.notes && (
                          <p className="text-gray-600">{order.deliveryAddress.notes}</p>
                        )}
                      </>
                    )}
                    {order.deliveryType === 'pickup' && (
                      <p>{t('confirmation.pickup_address', 'Abholung in unserem Restaurant: Kurhausstraße 11A, 97688 Bad Kissingen')}</p>
                    )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
