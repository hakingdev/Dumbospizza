"use client";

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { 
  LayoutDashboard, 
  Pizza, 
  ShoppingBag, 
  MapPin, 
  Settings, 
  Users, 
  LogOut,
  ChevronRight,
  Folder,
  Ticket,
  Megaphone,
  Ruler,
  Layers,
  ListPlus
} from 'lucide-react';

export default function AdminSidebar() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(true);

  const navItems = [
    {
      name: 'Dashboard',
      href: '/admin',
      icon: LayoutDashboard
    },
    {
      name: 'Products',
      href: '/admin/products',
      icon: Pizza
    },
    {
      name: 'Categories',
      href: '/admin/categories',
      icon: Folder
    },
    {
      name: 'Размеры',
      href: '/admin/size-variations',
      icon: Ruler
    },
    {
      name: 'Опции',
      href: '/admin/options',
      icon: ListPlus
    },
    {
      name: 'Группы опций',
      href: '/admin/option-groups',
      icon: Layers
    },
    {
      name: 'Orders',
      href: '/admin/orders',
      icon: ShoppingBag
    },
    {
      name: 'Coupons',
      href: '/admin/coupons',
      icon: Ticket
    },
    {
      name: 'Angebote',
      href: '/admin/promotions',
      icon: Megaphone
    },
    {
      name: 'Delivery Zones',
      href: '/admin/delivery-zones',
      icon: MapPin
    },
    {
      name: 'Customers',
      href: '/admin/customers',
      icon: Users
    },
    {
      name: 'Settings',
      href: '/admin/settings',
      icon: Settings
    }
  ];

  return (
    <div className={`bg-white border-r border-gray-200 ${expanded ? 'w-64' : 'w-20'} transition-all duration-300 flex flex-col h-screen`}>
      {/* Sidebar header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-gray-200">
        {expanded ? (
          <span className="text-xl font-bold text-primary-600">Admin Panel</span>
        ) : (
          <span className="text-xl font-bold text-primary-600">AP</span>
        )}
        <button 
          onClick={() => setExpanded(!expanded)} 
          className="p-1 rounded-md hover:bg-gray-100"
        >
          <ChevronRight className={`h-5 w-5 text-gray-500 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="mt-6 px-2 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center px-2 py-3 rounded-md ${
                isActive
                  ? 'bg-primary-50 text-primary-600'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <item.icon className="h-5 w-5 mr-3" />
              {expanded && <span>{item.name}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Sidebar footer */}
      <div className="sticky bottom-0 w-full border-t border-gray-200 p-4 bg-white mt-auto">
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: '/admin/login' })}
          className="flex items-center w-full text-left text-gray-700 hover:text-primary-600"
        >
          <LogOut className="h-5 w-5 mr-3" />
          {expanded && <span>Logout</span>}
        </button>
      </div>
    </div>
  );
}
