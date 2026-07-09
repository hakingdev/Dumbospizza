"use client";

import { useState, useEffect } from 'react';
import { Search, ShoppingBag, Eye, ChevronDown, ChevronUp, Download } from 'lucide-react';
import OrderTaxSummary from '../../../components/admin/OrderTaxSummary';
import PaymentRefundPanel from '../../../components/admin/PaymentRefundPanel';
const EXPORT_STATUSES = [
  { value: '', label: 'Все статусы' },
  { value: 'new', label: 'Новый' },
  { value: 'preparing', label: 'Готовится' },
  { value: 'ready_for_delivery', label: 'Готов к доставке' },
  { value: 'delivering', label: 'В пути' },
  { value: 'completed', label: 'Доставлен' },
  { value: 'cancelled', label: 'Отменен' },
];

function buildExportHref(format: 'csv' | 'xlsx', status: string, start: string, end: string): string {
  const p = new URLSearchParams({ format });
  if (status) p.set('status', status);
  if (start) p.set('startDate', start);
  if (end) p.set('endDate', end);
  return `/api/orders/export?${p.toString()}`;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState('');
  const [exportStart, setExportStart] = useState('');
  const [exportEnd, setExportEnd] = useState('');

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const response = await fetch('/api/orders?limit=100');
        const data = await response.json();
        
        if (data.success && data.orders) {
          setOrders(data.orders);
        }
      } catch (error) {
        console.error('Error fetching orders:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchOrders();
  }, []);

  const handleStatusChange = async (orderId: string, newStatus: string) => {
    setUpdatingStatus(orderId);
    try {
      const response = await fetch(`/api/orders/${orderId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus })
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Update local state
        setOrders(orders.map((order: any) => 
          (order._id === orderId || order.id === orderId) 
            ? { ...order, status: newStatus }
            : order
        ));
      } else {
        alert('Ошибка при обновлении статуса: ' + (data.error || 'Неизвестная ошибка'));
      }
    } catch (error) {
      console.error('Error updating order status:', error);
      alert('Ошибка при обновлении статуса заказа');
    } finally {
      setUpdatingStatus(null);
    }
  };

  const toggleOrderDetails = (orderId: string) => {
    setExpandedOrder(expandedOrder === orderId ? null : orderId);
  };

  const getStatusOptions = (currentStatus: string) => {
    const allStatuses = [
      { value: 'new', label: 'Новый' },
      { value: 'preparing', label: 'Готовится' },
      { value: 'ready_for_delivery', label: 'Готов к доставке' },
      { value: 'delivering', label: 'В пути' },
      { value: 'completed', label: 'Доставлен' },
      { value: 'cancelled', label: 'Отменен' }
    ];
    return allStatuses;
  };

  if (loading) {
    return <div>Загрузка...</div>;
  }

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold">Заказы</h1>
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Поиск заказов..."
            className="pl-10 pr-4 py-2 border rounded-lg w-full"
          />
        </div>
      </div>

      <div className="mb-6 p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">Выгрузка (CSV / Excel)</h2>
        <p className="text-xs text-gray-500 mb-3">
          Укажи период и при необходимости статус — ссылки учитывают фильтры. Пустые поля = без ограничения.
        </p>
        <div className="flex flex-col lg:flex-row lg:flex-wrap gap-3 lg:items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Статус</label>
            <select
              value={exportStatus}
              onChange={(e) => setExportStatus(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm min-w-[200px]"
            >
              {EXPORT_STATUSES.map((o) => (
                <option key={o.value || 'all'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Дата с</label>
            <input
              type="date"
              value={exportStart}
              onChange={(e) => setExportStart(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Дата по</label>
            <input
              type="date"
              value={exportEnd}
              onChange={(e) => setExportEnd(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={buildExportHref('csv', exportStatus, exportStart, exportEnd)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium"
            >
              <Download className="h-4 w-4" />
              Скачать CSV
            </a>
            <a
              href={buildExportHref('xlsx', exportStatus, exportStart, exportEnd)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-primary-600 text-primary-700 rounded-lg hover:bg-primary-50 text-sm font-medium"
            >
              <Download className="h-4 w-4" />
              Скачать Excel
            </a>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
        {orders.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <ShoppingBag className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p>Пока нет заказов</p>
          </div>
        ) : (
          <table className="min-w-[900px] w-full">
            <thead>
              <tr className="border-b">
                <th className="px-4 sm:px-6 py-3 text-left">ID</th>
                <th className="px-4 sm:px-6 py-3 text-left">Клиент</th>
                <th className="px-4 sm:px-6 py-3 text-left">Сумма</th>
                <th className="px-4 sm:px-6 py-3 text-left">Статус</th>
                <th className="px-4 sm:px-6 py-3 text-left">Время</th>
                <th className="px-4 sm:px-6 py-3 text-left">Действия</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order: any) => {
                const orderId = order._id || order.id;
                const isExpanded = expandedOrder === orderId;
                const isUpdating = updatingStatus === orderId;
                
                return (
                  <>
                    <tr key={orderId} className="border-b hover:bg-gray-50">
                      <td className="px-4 sm:px-6 py-4">#{order.orderNumber || orderId}</td>
                      <td className="px-4 sm:px-6 py-4">
                        <div>
                          <div className="font-medium">{order.customerName}</div>
                          <div className="text-sm text-gray-500">{order.phoneNumber}</div>
                        </div>
                      </td>
                      <td className="px-4 sm:px-6 py-4">{order.total?.toFixed(2) || '0.00'} €</td>
                      <td className="px-4 sm:px-6 py-4">
                        <select
                          value={order.status || 'new'}
                          onChange={(e) => handleStatusChange(orderId, e.target.value)}
                          disabled={isUpdating}
                          className={`px-2 py-1 rounded text-xs border-0 ${
                            order.status === 'new' ? 'bg-blue-100 text-blue-700' :
                            order.status === 'preparing' ? 'bg-yellow-100 text-yellow-700' :
                            order.status === 'ready_for_delivery' ? 'bg-purple-100 text-purple-700' :
                            order.status === 'delivering' ? 'bg-orange-100 text-orange-700' :
                            order.status === 'completed' ? 'bg-green-100 text-green-700' :
                            order.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                            'bg-gray-100 text-gray-700'
                          } ${isUpdating ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          {getStatusOptions(order.status).map(opt => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 sm:px-6 py-4">
                        {new Date(order.createdAt).toLocaleString('ru-RU', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </td>
                      <td className="px-4 sm:px-6 py-4">
                        <button
                          onClick={() => toggleOrderDetails(orderId)}
                          className="text-primary-600 hover:text-primary-700 flex items-center gap-1"
                        >
                          <Eye className="h-4 w-4" />
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} className="px-4 sm:px-6 py-4 bg-gray-50">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                              <h4 className="font-semibold mb-2">Детали заказа</h4>
                              <div className="space-y-2">
                                {order.items?.map((item: any, idx: number) => (
                                  <div key={idx} className="text-sm">
                                    <div className="font-medium">
                                      {item.name} {item.size?.name && `(${item.size.name})`} × {item.quantity}
                                    </div>
                                    {item.extras && (
                                      <div className="text-gray-600 ml-4">
                                        {item.extras.toppings?.map((t: any, i: number) => (
                                          <div key={i}>+ {t.name}</div>
                                        ))}
                                        {item.extras.sauces?.map((s: any, i: number) => (
                                          <div key={i}>+ {s.name}</div>
                                        ))}
                                        {item.extras.sides?.map((s: any, i: number) => (
                                          <div key={i}>+ {s.name}</div>
                                        ))}
                                      </div>
                                    )}
                                    {item.options && item.options.length > 0 && (
                                      <div className="text-gray-600 ml-4">
                                        {item.options.map((o: any, i: number) => (
                                          <div key={i}>+ {o.group ? `${o.group}: ` : ''}{o.name}</div>
                                        ))}
                                      </div>
                                    )}
                                    <div className="text-gray-500">
                                      {(item.price * item.quantity).toFixed(2)} €
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-4 pt-4 border-t">
                                <div className="flex justify-between text-sm">
                                  <span>Сумма:</span>
                                  <span>{order.subtotal?.toFixed(2)} €</span>
                                </div>
                                {order.deliveryFee > 0 && (
                                  <div className="flex justify-between text-sm">
                                    <span>Доставка:</span>
                                    <span>{order.deliveryFee?.toFixed(2)} €</span>
                                  </div>
                                )}
                                <div className="flex justify-between font-semibold mt-2 pt-2 border-t">
                                  <span>Итого:</span>
                                  <span>{order.total?.toFixed(2)} €</span>
                                </div>
                              </div>
                              <OrderTaxSummary order={order} />
                            </div>
                            <div>
                              <h4 className="font-semibold mb-2">Контактная информация</h4>
                              <div className="text-sm space-y-1">
                                <div><strong>Имя:</strong> {order.customerName}</div>
                                <div><strong>Телефон:</strong> {order.phoneNumber}</div>
                                {order.email && <div><strong>Email:</strong> {order.email}</div>}
                              </div>
                              <h4 className="font-semibold mb-2 mt-4">
                                {order.deliveryType === 'delivery' ? 'Адрес доставки' : 'Самовывоз'}
                              </h4>
                              {order.deliveryType === 'delivery' && order.deliveryAddress && (
                                <div className="text-sm">
                                  <div>{order.deliveryAddress.street} {order.deliveryAddress.houseNumber}</div>
                                  {order.deliveryAddress.floor && <div>Этаж: {order.deliveryAddress.floor}</div>}
                                  <div>{order.deliveryAddress.postalCode} {order.deliveryAddress.city}</div>
                                  {order.deliveryAddress.notes && (
                                    <div className="text-gray-600 mt-1">{order.deliveryAddress.notes}</div>
                                  )}
                                </div>
                              )}
                              {order.deliveryType === 'pickup' && (
                                <div className="text-sm">Самовывоз из ресторана</div>
                              )}
                              {order.deliveryType === 'delivery' && order.desiredDeliveryTime && (
                                <div className="text-sm mt-2"><strong>Желаемое время:</strong> {order.desiredDeliveryTime}</div>
                              )}
                              <h4 className="font-semibold mb-2 mt-4">Способ оплаты</h4>
                              <div className="text-sm">
                                {order.paymentMethod === 'cash' && 'Наличными'}
                                {order.paymentMethod === 'card' && 'Картой'}
                                {order.paymentMethod === 'online' && 'Онлайн'}
                              </div>
                              {/* PayPal-платежи заказа + возвраты (для SumUp записей нет — панель скрыта) */}
                              {order.paymentMethod === 'online' && (
                                <PaymentRefundPanel orderId={orderId} />
                              )}
                              {order.notes && (
                                <>
                                  <h4 className="font-semibold mb-2 mt-4">Примечания</h4>
                                  <div className="text-sm text-gray-600">{order.notes}</div>
                                </>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

