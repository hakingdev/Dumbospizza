'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShoppingBag, Loader2 } from 'lucide-react';
import OrderHistoryItem from '../profile/OrderHistoryItem';

export default function OrdersTab() {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/customer/orders')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          // OrderHistoryItem ожидает _id; маппим id → _id.
          setOrders((d.orders || []).map((o: any) => ({ ...o, _id: o.id })));
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="rounded-lg bg-white p-6 text-center shadow sm:p-10">
        <ShoppingBag className="mx-auto mb-3 h-12 w-12 text-gray-300" />
        <h3 className="mb-1 text-pretty text-lg font-medium leading-tight text-gray-900">
          Noch keine Bestellungen
        </h3>
        <p className="mb-4 text-pretty text-gray-500">Ihre Bestellungen erscheinen hier.</p>
        <Link
          href="/"
          className="inline-flex min-h-[40px] items-center justify-center whitespace-nowrap rounded-md bg-primary-600 px-4 py-2 text-sm font-medium leading-none text-white hover:bg-primary-700"
        >
          Zur Speisekarte
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {orders.map((order) => (
        <OrderHistoryItem key={order._id} order={order} showDetails />
      ))}
    </div>
  );
}
