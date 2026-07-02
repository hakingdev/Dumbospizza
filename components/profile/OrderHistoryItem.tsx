import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Clock,
  MapPin,
  ArrowRight,
  RotateCw,
  Loader2,
  Download,
} from 'lucide-react';
import { useLanguage } from '../../lib/contexts/LanguageContext';
import { loadTranslation } from '../../lib/i18n';
import { repeatOrder } from '../../lib/api-client';
import { useCart } from '../../lib/contexts/CartContext';
import { isOnlinePaymentMethod } from '../../lib/orders/tax';
import { downloadOrderInvoice } from '../../lib/orders/download-invoice';
import { NoTranslate } from '../NoTranslate';

interface OrderHistoryItemProps {
  order: any;
  showDetails?: boolean;
}

export default function OrderHistoryItem({
  order,
  showDetails = false,
}: OrderHistoryItemProps) {
  const router = useRouter();
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string, fallback?: string) => fallback ?? k);
  const [isRepeating, setIsRepeating] = useState(false);
  const [isDownloadingInvoice, setIsDownloadingInvoice] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const { addItem, clearCart } = useCart();

  // Invoice (Rechnung) скачиваем только для онлайн-оплаченных заказов:
  // онлайн-метод + подтверждённая оплата. Для оплаты при получении кнопки нет.
  const isOnlinePaid =
    isOnlinePaymentMethod(order.paymentMethod) &&
    (order.paymentStatus === 'completed' || order.paymentStatus === 'paid');

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
      minute: '2-digit',
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

  const handleDownloadInvoice = async () => {
    if (isDownloadingInvoice) return;
    setIsDownloadingInvoice(true);
    setInvoiceError(null);
    try {
      // Авторизация — по cookie-сессии клиента (credentials: include в
      // downloadOrderInvoice); токен здесь не нужен.
      await downloadOrderInvoice(order._id, {
        orderNumber: order.orderNumber,
      });
    } catch (err: any) {
      setInvoiceError(
        err?.message ||
          t('profile.invoice_error', 'Rechnung konnte nicht erstellt werden.'),
      );
    } finally {
      setIsDownloadingInvoice(false);
    }
  };

  const handleRepeatOrder = async () => {
    if (isRepeating) return;

    setIsRepeating(true);
    try {
      const result = await repeatOrder(order._id);

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
    <div className="overflow-hidden rounded-lg bg-white shadow-lg transition-shadow duration-200 hover:shadow-xl">
      <div className="border-b p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="mb-1 truncate text-xl font-semibold leading-tight">
              {t('order', 'Bestellung')} <NoTranslate>#{order.orderNumber}</NoTranslate>
            </h3>
            <div className="flex min-w-0 items-start text-sm leading-5 text-gray-500">
              <Clock className="mr-1 mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 text-pretty">
                {formatDate(order.createdAt)}
              </span>
            </div>
          </div>

          <div className="shrink-0 sm:text-right">
            <div className="whitespace-nowrap font-medium">
              <NoTranslate>{order.total.toFixed(2)} €</NoTranslate>
            </div>
            <div
              className={`mt-1 inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-5 sm:max-w-[14rem] ${getStatusClass(order.status)}`}
            >
              {t(`track.order_status.${order.status}`)}
            </div>
          </div>
        </div>

        <div className="mt-3 flex min-w-0 flex-wrap gap-1">
          {order.items.slice(0, 3).map((item: any, index: number) => (
            <span
              key={index}
              className="inline-flex max-w-full items-center truncate rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium leading-5 text-gray-800"
            >
              <NoTranslate>{item.quantity}× {item.name}{item.size ? ` (${item.size.name})` : ''}</NoTranslate>
            </span>
          ))}

          {order.items.length > 3 && (
            <span className="inline-flex max-w-full items-center whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium leading-5 text-gray-800">
              +{order.items.length - 3} {t('profile.more_items', 'weitere Artikel')}
            </span>
          )}
        </div>

        {showDetails && (
          <div className="mt-2 flex min-w-0 items-start text-sm leading-5 text-gray-500">
            <MapPin className="mr-1 mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 text-pretty">
              {order.deliveryType === 'delivery'
                ? (
                  <NoTranslate>
                    {order.deliveryAddress?.street} {order.deliveryAddress?.houseNumber}, {order.deliveryAddress?.postalCode}
                  </NoTranslate>
                )
                : t('track.pickup', 'Abholung')}
            </span>
          </div>
        )}
      </div>

      <div className="bg-gray-50 px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            onClick={handleRepeatOrder}
            disabled={isRepeating}
            className="inline-flex items-center whitespace-nowrap text-sm font-medium text-primary-600 hover:text-primary-800"
          >
            {isRepeating ? (
              <Loader2 className="mr-1 h-4 w-4 shrink-0 animate-spin" />
            ) : (
              <RotateCw className="mr-1 h-4 w-4 shrink-0" />
            )}
            {t('profile.repeat_order')}
          </button>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:justify-end">
            {isOnlinePaid && (
              <button
                onClick={handleDownloadInvoice}
                disabled={isDownloadingInvoice}
                className="inline-flex items-center whitespace-nowrap text-sm font-medium text-primary-600 hover:text-primary-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDownloadingInvoice ? (
                  <Loader2 className="mr-1 h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <Download className="mr-1 h-4 w-4 shrink-0" />
                )}
                {t('profile.download_invoice', 'Rechnung herunterladen')}
              </button>
            )}

            <Link
              href={`/track?orderNumber=${order.orderNumber}`}
              className="inline-flex items-center whitespace-nowrap text-sm font-medium text-gray-600 hover:text-gray-800"
            >
              {t('profile.view_details')}
              <ArrowRight className="ml-1 h-4 w-4 shrink-0" />
            </Link>
          </div>
        </div>

        {invoiceError && (
          <p className="mt-2 text-pretty text-xs leading-5 text-red-600 sm:text-right">
            {invoiceError}
          </p>
        )}
      </div>
    </div>
  );
}
