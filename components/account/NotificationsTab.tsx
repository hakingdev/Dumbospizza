'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Bell,
  Loader2,
  Gift,
  ShoppingBag,
  Star,
  Info,
  CheckCheck,
} from 'lucide-react';

const CATEGORY_ICON: Record<string, any> = {
  promo: Gift,
  order: ShoppingBag,
  loyalty: Star,
  system: Info,
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function NotificationsTab({
  onChanged,
}: {
  onChanged?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<any[]>([]);

  const load = useCallback(async () => {
    const res = await fetch('/api/customer/notifications');
    const d = await res.json();
    if (d.success) setItems(d.notifications || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const markRead = async (id: string) => {
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    await fetch('/api/customer/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    onChanged?.();
  };

  const markAll = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    await fetch('/api/customer/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    });
    onChanged?.();
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg bg-white p-6 text-center shadow sm:p-10">
        <Bell className="mx-auto mb-3 h-12 w-12 text-gray-300" />
        <p className="text-pretty text-gray-500">Keine Benachrichtigungen.</p>
      </div>
    );
  }

  const hasUnread = items.some((n) => !n.read);

  return (
    <div>
      {hasUnread && (
        <div className="mb-3 flex justify-start sm:justify-end">
          <button
            onClick={markAll}
            className="inline-flex items-center whitespace-nowrap text-sm font-medium text-primary-600 hover:text-primary-700"
          >
            <CheckCheck className="mr-1 h-4 w-4 shrink-0" /> Alle als gelesen
            markieren
          </button>
        </div>
      )}
      <ul className="space-y-2">
        {items.map((n) => {
          const Icon = CATEGORY_ICON[n.category] || Info;
          return (
            <li
              key={n.id}
              onClick={() => !n.read && markRead(n.id)}
              className={`cursor-pointer rounded-lg border p-3 shadow-sm transition-colors sm:p-4 ${
                n.read
                  ? 'border-gray-100 bg-white'
                  : 'border-primary-200 bg-primary-50/60'
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    n.read
                      ? 'bg-gray-100 text-gray-500'
                      : 'bg-primary-600 text-white'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="min-w-0 text-pretty font-semibold leading-snug text-gray-900">
                      {n.title}
                    </h4>
                    {!n.read && (
                      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary-600" />
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-line text-pretty text-sm leading-6 text-gray-600">
                    {n.body}
                  </p>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-xs leading-none text-gray-400">
                      {fmtDate(n.createdAt)}
                    </span>
                    {n.link && (
                      <Link
                        href={n.link}
                        onClick={(e) => e.stopPropagation()}
                        className="whitespace-nowrap text-sm font-medium leading-none text-primary-600 hover:underline"
                      >
                        {n.linkLabel || 'Ansehen'} →
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
