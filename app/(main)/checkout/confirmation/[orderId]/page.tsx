"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, ArrowRight, Clock } from 'lucide-react';
import Link from 'next/link';
import { useCart } from '../../../../../lib/contexts/CartContext';
import { useLanguage } from '../../../../../lib/contexts/LanguageContext';
import { loadTranslation } from '../../../../../lib/i18n';
import OrderVatReceipt from '../../../../../components/checkout/OrderVatReceipt';
import OrderVatReceiptModal from '../../../../../components/checkout/OrderVatReceiptModal';

interface OrderConfirmationProps {
  params: {
    orderId: string;
  };
}

export default function OrderConfirmationPage({ params }: OrderConfirmationProps) {
  const { orderId } = params;
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const { clearCart } = useCart();
  const router = useRouter();
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string) => k);
  
  // Fetch order details
  useEffect(() => {
    const fetchOrder = async () => {
      try {
        const storedPhone = sessionStorage.getItem(`order:${orderId}:phone`);
        const query = storedPhone ? `?phoneNumber=${encodeURIComponent(storedPhone)}` : '';
        const response = await fetch(`/api/orders/${orderId}${query}`);
        if (!response.ok) {
          throw new Error('Bestellung nicht gefunden');
        }
        
        const data = await response.json();
        if (data.success && data.order) {
          setOrder(data.order);
          
          // Clear cart after successful order
          clearCart();
        } else {
          throw new Error('Bestelldaten konnten nicht geladen werden');
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    
    fetchOrder();
  }, [orderId, clearCart]);

  // После успешной онлайн-оплаты checkout редиректит сюда с ?paid=1 — тогда
  // автоматически показываем клиенту НДС-чек (Beleg) во всплывающей модалке.
  // Параметр снимаем из URL, чтобы при обновлении страницы чек не всплывал снова.
  useEffect(() => {
    if (!order) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('paid') === '1') {
      setReceiptModalOpen(true);
      params.delete('paid');
      const query = params.toString();
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${query ? `?${query}` : ''}`
      );
    }
  }, [order]);

  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    };

    loadTranslations();
  }, [language]);
  
  // Redirect to homepage if no orderId
  useEffect(() => {
    if (!orderId) {
      router.push('/');
    }
  }, [orderId, router]);
  
  if (loading) {
    return (
      <div className="container mx-auto px-4 py-16 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-16 h-16 border-4 border-primary-600 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-lg">{t('confirmation.loading', 'Bestellinformationen werden geladen...')}</p>
        </div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-lg mx-auto bg-white rounded-lg shadow-lg p-6 text-center">
          <div className="text-red-500 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
            </svg>
          </div>
          <h2 className="text-2xl font-semibold mb-4">{t('confirmation.error_title', 'Fehler')}</h2>
          <p className="mb-6">{error}</p>
          <Link href="/" className="inline-flex min-h-[48px] items-center justify-center rounded-lg bg-primary-600 px-6 py-3 text-center leading-tight text-white hover:bg-primary-700">
            {t('common.back_home', 'Zur Startseite')}
          </Link>
        </div>
      </div>
    );
  }
  
  if (!order) {
    return null;
  }
  
  return (
    <div className="container mx-auto px-4 py-12">
      <div className="max-w-2xl mx-auto">
        {/* Success message */}
        <div className="bg-white rounded-lg shadow-lg p-8 mb-6 text-center">
          <div className="text-green-500 mb-4">
            <CheckCircle className="w-20 h-20 mx-auto" />
          </div>
          
          <h1 className="text-3xl font-bold mb-2">{t('confirmation.thank_you', 'Vielen Dank für Ihre Bestellung!')}</h1>
          <p className="text-lg mb-6">
            {t('confirmation.order_success', 'Ihre Bestellung')} #{order.orderNumber} {t('confirmation.order_success_suffix', 'wurde erfolgreich aufgegeben.')}
            {order.deliveryType === 'delivery' 
              ? ` ${t('confirmation.delivery_info', 'Wir liefern sie so schnell wie möglich.')}` 
              : ` ${t('confirmation.pickup_info', 'Sie können sie in unserem Restaurant abholen.')}`}
          </p>
          
          <div className="border-t border-b border-gray-200 py-4 my-4">
            <p className="mb-1">{t('confirmation.confirmation_sent', 'Wir haben eine Bestätigung an Ihre Telefonnummer gesendet:')}</p>
            <p className="font-semibold text-lg">{order.phoneNumber}</p>
          </div>
          
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href={`/track?phoneNumber=${encodeURIComponent(order.phoneNumber)}`} 
                className="inline-flex min-h-[48px] items-center justify-center rounded-lg bg-primary-600 px-6 py-3 text-center leading-tight text-white hover:bg-primary-700">
              <Clock className="mr-2 h-5 w-5 shrink-0" />
              <span>{t('confirmation.track_order', 'Bestellung verfolgen')}</span>
            </Link>
            
            <Link href="/" className="inline-flex min-h-[48px] items-center justify-center rounded-lg border border-gray-300 px-6 py-3 text-center leading-tight hover:bg-gray-50">
              <ArrowRight className="mr-2 h-5 w-5 shrink-0" />
              <span>{t('confirmation.continue_shopping', 'Weiter einkaufen')}</span>
            </Link>
          </div>
        </div>
        
        {/* Order details */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold mb-2">{t('confirmation.order_details', 'Bestelldetails')} #{order.orderNumber}</h2>
            <p className="text-gray-600">
              {t('confirmation.order_date', 'Bestelldatum')}: {new Date(order.createdAt).toLocaleDateString('de-DE', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </p>
          </div>
          
          <div className="p-6">
            <h3 className="font-medium mb-2">{t('confirmation.order_items', 'Bestellte Artikel')}</h3>
            <ul className="divide-y divide-gray-100 mb-4">
              {order.items.map((item: any, i: number) => (
                <li key={i} className="py-3 flex justify-between">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    {item.size && <span className="text-gray-500">{item.size.name}</span>}

                    {/* Display customizations if any */}
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
                    <span className="text-gray-600 mr-2">{item.quantity}×</span>
                    <span>{(item.price * item.quantity).toFixed(2)} €</span>
                  </div>
                </li>
              ))}
            </ul>
            
            <div className="border-t pt-4">
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
              
              <div className="flex justify-between py-2 font-bold text-lg border-t mt-2">
                <span>{t('cart.total', 'Gesamt')}:</span>
                <span>{order.total.toFixed(2)} €</span>
              </div>
            </div>
            
            {order.loyaltyPointsEarned > 0 && (
              <div className="mt-4 p-3 bg-yellow-50 rounded-md">
                <p className="text-yellow-800">
                  {t('confirmation.points_earned', 'Sie haben')} {order.loyaltyPointsEarned} {t('confirmation.points_suffix', 'Punkte für diese Bestellung erhalten!')} 
                  {' '}{t('confirmation.points_hint', 'Nutzen Sie diese bei der nächsten Bestellung für einen Rabatt.')}
                </p>
              </div>
            )}
          </div>
          
          <div className="p-6 bg-gray-50 border-t border-gray-100">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-medium mb-2">{t('confirmation.contact_info', 'Kontaktinformationen')}</h3>
                <p>{order.customerName}</p>
                <p>{order.phoneNumber}</p>
                {order.email && <p>{order.email}</p>}
              </div>
              
              <div>
                <h3 className="font-medium mb-2">
                  {order.deliveryType === 'delivery' ? t('confirmation.delivery_address', 'Lieferadresse') : t('confirmation.pickup', 'Abholung')}
                </h3>
                {order.deliveryType === 'delivery' ? (
                  <>
                    <p>
                      {order.deliveryAddress.street} {order.deliveryAddress.houseNumber}
                      {order.deliveryAddress.floor && `, ${t('checkout.floor', 'Etage / Wohnung')} ${order.deliveryAddress.floor}`}
                    </p>
                    <p>{order.deliveryAddress.postalCode} {order.deliveryAddress.city}</p>
                    {order.deliveryAddress.notes && (
                      <p className="text-gray-500">{order.deliveryAddress.notes}</p>
                    )}
                  </>
                ) : (
                  <p>{t('confirmation.pickup_address', 'Abholung in unserem Restaurant: Kurhausstraße 11A, 97688 Bad Kissingen')}</p>
                )}
                {order.deliveryType === 'delivery' && order.desiredDeliveryTime && (
                  <p className="mt-2">
                    <span className="text-gray-600">{t('checkout.desired_delivery_time', 'Желаемое время доставки')}:</span>{' '}
                    {order.desiredDeliveryTime}
                  </p>
                )}
              </div>
            </div>
            
            <div className="mt-6">
              <h3 className="font-medium mb-2">{t('confirmation.payment_method', 'Zahlungsmethode')}</h3>
              <p>
                {order.paymentMethod === 'cash' && t('checkout.payments.cash', 'Bar bei Lieferung')}
                {order.paymentMethod === 'card' && t('checkout.payments.card', 'Karte bei Lieferung')}
                {order.paymentMethod === 'online' && t('checkout.payments.online', 'Online-Zahlung')}
              </p>
            </div>
          </div>
        </div>

        {/* НДС-чек (Beleg) — только для онлайн-оплаты, провайдер-независимо.
            Рендерим встроенно, только когда не открыта модалка: в DOM должен быть
            единственный #vat-receipt, иначе печать в PDF сработает некорректно. */}
        {!receiptModalOpen && <OrderVatReceipt order={order} />}
      </div>

      <OrderVatReceiptModal
        order={order}
        open={receiptModalOpen}
        onClose={() => setReceiptModalOpen(false)}
      />
    </div>
  );
}
