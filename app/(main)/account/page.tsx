'use client';

import { useEffect, useState } from 'react';
import { User as UserIcon, ShoppingBag, Star, Heart, Bell, Loader2 } from 'lucide-react';
import AccountAuth from '../../../components/account/AccountAuth';
import ProfileTab from '../../../components/account/ProfileTab';
import OrdersTab from '../../../components/account/OrdersTab';
import PointsTab from '../../../components/account/PointsTab';
import FavoritesTab from '../../../components/account/FavoritesTab';
import NotificationsTab from '../../../components/account/NotificationsTab';

type Tab = 'profile' | 'orders' | 'points' | 'favorites' | 'notifications';

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'profile', label: 'Profil', icon: UserIcon },
  { key: 'orders', label: 'Bestellungen', icon: ShoppingBag },
  { key: 'points', label: 'Punkte', icon: Star },
  { key: 'favorites', label: 'Favoriten', icon: Heart },
  { key: 'notifications', label: 'Mitteilungen', icon: Bell },
];

export default function AccountPage() {
  const [status, setStatus] = useState<'loading' | 'auth' | 'ready'>('loading');
  const [user, setUser] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('profile');
  const [unread, setUnread] = useState(0);

  const refreshUnread = async () => {
    try {
      const res = await fetch('/api/customer/notifications?countOnly=1');
      const d = await res.json();
      if (d.success) setUnread(d.unreadCount || 0);
    } catch {
      /* ignore */
    }
  };

  const loadProfile = async () => {
    try {
      const res = await fetch('/api/customer/me');
      if (res.status === 401) {
        setStatus('auth');
        return;
      }
      const data = await res.json();
      if (data.success) {
        setUser(data.user);
        setStatus('ready');
        refreshUnread();
      } else {
        setStatus('auth');
      }
    } catch {
      setStatus('auth');
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const logout = async () => {
    await fetch('/api/customer/auth/logout', { method: 'POST' });
    setUser(null);
    setStatus('auth');
  };

  if (status === 'loading') {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (status === 'auth') {
    return <AccountAuth onAuthenticated={loadProfile} />;
  }

  return (
    <div className="container mx-auto max-w-3xl px-3 py-6 sm:px-4 sm:py-8">
      <div className="mb-5 min-w-0 sm:mb-6">
        <h1 className="text-2xl font-bold leading-tight text-gray-900">Mein Konto</h1>
        <p className="mt-1 truncate text-sm text-gray-500">Hallo, {user?.name}</p>
      </div>

      {/* Tabs: horizontal scroll on small screens, equal columns from sm up. */}
      <div className="scrollbar-hide mb-6 flex gap-1 overflow-x-auto rounded-lg bg-white p-1 shadow-sm sm:grid sm:grid-cols-5 sm:overflow-visible">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`relative flex h-10 min-w-max shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium leading-none transition-colors sm:min-w-0 sm:px-2 ${
              tab === key
                ? 'bg-primary-600 text-white'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <span className="relative">
              <Icon className="h-4 w-4" />
              {key === 'notifications' && unread > 0 && (
                <span className="absolute -right-2 -top-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-secondary-600 px-1 text-[10px] font-bold text-white">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </span>
            {label}
          </button>
        ))}
      </div>

      <div>
        {tab === 'profile' && (
          <ProfileTab user={user} onUpdated={setUser} onLogout={logout} />
        )}
        {tab === 'orders' && <OrdersTab />}
        {tab === 'points' && <PointsTab />}
        {tab === 'favorites' && <FavoritesTab />}
        {tab === 'notifications' && <NotificationsTab onChanged={refreshUnread} />}
      </div>
    </div>
  );
}
