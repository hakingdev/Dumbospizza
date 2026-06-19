"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Pizza, ShoppingBag, MapPin, Users, Loader2 } from 'lucide-react';

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    totalOrders: 0,
    activeProducts: 0,
    deliveryZones: 0,
    customers: 0
  });
  const [recentOrders, setRecentOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      // Fetch products count
      const productsRes = await fetch('/api/products?available=true&source=local');
      const productsData = await productsRes.json();
      
      // Fetch orders
      const ordersRes = await fetch('/api/orders?limit=5');
      const ordersData = await ordersRes.json();
      
      // Fetch all orders for count
      const allOrdersRes = await fetch('/api/orders?limit=1000');
      const allOrdersData = await allOrdersRes.json();
      
      // Get unique customers count
      const uniqueCustomers = new Set(
        allOrdersData.success && allOrdersData.orders 
          ? allOrdersData.orders.map((o: any) => o.phoneNumber)
          : []
      );
      
      setStats({
        totalOrders: allOrdersData.success && allOrdersData.orders ? allOrdersData.orders.length : 0,
        activeProducts: productsData.success ? productsData.products.length : 0,
        deliveryZones: 5,
        customers: uniqueCustomers.size
      });
      
      // Set recent orders
      if (ordersData.success && ordersData.orders) {
        setRecentOrders(ordersData.orders.map((order: any) => ({
          id: order.orderNumber || order._id,
          customer: order.customerName,
          amount: order.total?.toFixed(2) || '0.00',
          status: order.status === 'new' ? 'New' :
                  order.status === 'preparing' ? 'Preparing' :
                  order.status === 'ready_for_delivery' ? 'Ready' :
                  order.status === 'delivering' ? 'Delivering' :
                  order.status === 'completed' ? 'Completed' :
                  order.status === 'cancelled' ? 'Cancelled' : 'New',
          time: new Date(order.createdAt).toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          })
        })));
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="text-sm text-gray-500">
          {new Date().toLocaleDateString('de-DE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
          <div className="flex justify-between items-center">
            <div className="p-2 rounded-md bg-primary-50">
              <ShoppingBag className="h-6 w-6 text-primary-600" />
            </div>
          </div>
          <div className="mt-4">
            <span className="block text-2xl font-bold">{stats.totalOrders}</span>
            <span className="text-gray-500 text-sm">Total Orders</span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
          <div className="flex justify-between items-center">
            <div className="p-2 rounded-md bg-primary-50">
              <Pizza className="h-6 w-6 text-primary-600" />
            </div>
          </div>
          <div className="mt-4">
            <span className="block text-2xl font-bold">{stats.activeProducts}</span>
            <span className="text-gray-500 text-sm">Active Products</span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
          <div className="flex justify-between items-center">
            <div className="p-2 rounded-md bg-primary-50">
              <MapPin className="h-6 w-6 text-primary-600" />
            </div>
          </div>
          <div className="mt-4">
            <span className="block text-2xl font-bold">{stats.deliveryZones}</span>
            <span className="text-gray-500 text-sm">Delivery Zones</span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
          <div className="flex justify-between items-center">
            <div className="p-2 rounded-md bg-primary-50">
              <Users className="h-6 w-6 text-primary-600" />
            </div>
          </div>
          <div className="mt-4">
            <span className="block text-2xl font-bold">{stats.customers}</span>
            <span className="text-gray-500 text-sm">Customers</span>
          </div>
        </div>
      </div>

      {/* Recent Orders */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 mb-8">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center">
          <h2 className="text-lg font-semibold">Recent Orders</h2>
          <Link href="/admin/orders" className="text-primary-600 hover:text-primary-700 text-sm flex items-center">
            View all <ArrowUpRight className="h-4 w-4 ml-1" />
          </Link>
        </div>
        <div className="p-6">
          {recentOrders.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <ShoppingBag className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p>Пока нет заказов</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-gray-500 border-b">
                  <th className="pb-3">ORDER ID</th>
                  <th className="pb-3">CUSTOMER</th>
                  <th className="pb-3">AMOUNT</th>
                  <th className="pb-3">STATUS</th>
                  <th className="pb-3">TIME</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order: any) => (
                  <tr key={order.id} className="border-b last:border-0">
                    <td className="py-3 font-medium">#{order.id}</td>
                    <td className="py-3">{order.customer}</td>
                    <td className="py-3">{order.amount} €</td>
                    <td className="py-3">
                      <span className={`px-2 py-1 rounded text-xs ${
                        order.status === 'Completed' ? 'bg-green-100 text-green-700' :
                        order.status === 'Delivering' ? 'bg-blue-100 text-blue-700' :
                        order.status === 'Preparing' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {order.status}
                      </span>
                    </td>
                    <td className="py-3 text-gray-500">{order.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link href="/admin/products/new" className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
          <div className="flex items-center">
            <div className="p-3 rounded-md bg-primary-50 mr-4">
              <Pizza className="h-6 w-6 text-primary-600" />
            </div>
            <div>
              <h3 className="font-semibold mb-1">Add New Product</h3>
              <p className="text-sm text-gray-500">Create a new menu item</p>
            </div>
          </div>
        </Link>

        <Link href="/admin/delivery-zones" className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
          <div className="flex items-center">
            <div className="p-3 rounded-md bg-primary-50 mr-4">
              <MapPin className="h-6 w-6 text-primary-600" />
            </div>
            <div>
              <h3 className="font-semibold mb-1">Manage Delivery Zones</h3>
              <p className="text-sm text-gray-500">Edit zones and pricing</p>
            </div>
          </div>
        </Link>

        <Link href="/admin/settings" className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
          <div className="flex items-center">
            <div className="p-3 rounded-md bg-primary-50 mr-4">
              <Users className="h-6 w-6 text-primary-600" />
            </div>
            <div>
              <h3 className="font-semibold mb-1">Store Settings</h3>
              <p className="text-sm text-gray-500">Update store information</p>
            </div>
          </div>
        </Link>
      </div>
    </>
  );
}
