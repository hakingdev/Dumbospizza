import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Clock, MapPin, ArrowRight, RotateCw, Loader2 } from 'lucide-react';
import { useLanguage } from '../../lib/contexts/LanguageContext';
import { loadTranslation } from '../../lib/i18n';
import { repeatOrder } from '../../lib/api-client';
import { useCart } from '../../lib/contexts/CartContext';

interface OrderHistoryItemProps {
  order: any;
  showDetails?: boolean;
}

export default function OrderHistoryItem({ order, showDetails = false }: OrderHistoryItemProps) {
  const router = useRouter();
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string) => k);
  const [isRepeating, setIsRepeating] = useState(false);
  const { addItem, clearCart } = useCart();
  
  useEffect(() => {
    const loadTranslations = async () => {
      const { t: translation } = await loadTranslation(language);
      setT(() => translation);
    };
    
    loadTranslations();
  }, [language]);
  
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(language === 'de' ? 'de-DE' : 'ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };
  
  const getStatusClass = (status: string) => {
    switch (status) {
      case 'new':
        return 'bg-blue-100 text-blue-800';
      case 'preparing':
        return 'bg-yellow-100 text-yellow-800';
      case 'ready_for_delivery':
        return 'bg-orange-100 text-orange-800';
      case 'delivering':
        return 'bg-indigo-100 text-indigo-800';
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };
  
  const handleRepeatOrder = async () => {
    if (isRepeating) return;
    
    setIsRepeating(true);
    try {
      const result = await repeatOrder(order._id, order.phoneNumber);
      
      if (result.success && result.orderData) {
        // Очищаем корзину перед добавлением новых товаров
        clearCart();
        
        // Добавляем каждый товар из предыдущего заказа в корзину
        for (const item of result.orderData.items) {
          addItem(item);
        }
        
        // Перенаправляем на корзину
        router.push('/cart');
      }
    } catch (error) {
      console.error('Error repeating order:', error);
    } finally {
      setIsRepeating(false);
    }
  };
  
  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden hover:shadow-xl transition-shadow duration-200">
      <div className="p-4 border-b">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-semibold text-xl mb-1">
              {t('order')} #{order.orderNumber}
            </h3>
            <div className="flex items-center text-sm text-gray-500">
              <Clock className="h-4 w-4 mr-1" />
              <span>{formatDate(order.createdAt)}</span>
            </div>
          </div>
          
          <div className="text-right">
            <div className="font-medium">{order.total.toFixed(2)} €</div>
            <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium mt-1 ${getStatusClass(order.status)}`}>
              {t(`track.order_status.${order.status}`)}
            </div>
          </div>
        </div>
        
        <div className="mt-3 flex flex-wrap gap-1">
          {order.items.slice(0, 3).map((item: any, index: number) => (
            <span 
              key={index} 
              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800"
            >
              {item.quantity}× {item.name}
              {item.size ? ` (${item.size.name})` : ''}
            </span>
          ))}
          
          {order.items.length > 3 && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
              +{order.items.length - 3} {t('profile.more_items')}
            </span>
          )}
        </div>
        
        {showDetails && (
          <div className="mt-2 flex items-center text-sm text-gray-500">
            <MapPin className="h-4 w-4 mr-1" />
            <span>
              {order.deliveryType === 'delivery' ? (
                `${order.deliveryAddress?.street} ${order.deliveryAddress?.houseNumber}, ${order.deliveryAddress?.postalCode}`
              ) : (
                t('track.pickup')
              )}
            </span>
          </div>
        )}
      </div>
      
      <div className="px-4 py-3 bg-gray-50 flex justify-between items-center">
        <button
          onClick={handleRepeatOrder}
          disabled={isRepeating}
          className="flex items-center text-sm text-primary-600 hover:text-primary-800"
        >
          {isRepeating ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <RotateCw className="h-4 w-4 mr-1" />
          )}
          {t('profile.repeat_order')}
        </button>
        
        <Link href={`/track?orderNumber=${order.orderNumber}`} className="flex items-center text-sm text-gray-600 hover:text-gray-800">
          {t('profile.view_details')}
          <ArrowRight className="h-4 w-4 ml-1" />
        </Link>
      </div>
    </div>
  );
}
