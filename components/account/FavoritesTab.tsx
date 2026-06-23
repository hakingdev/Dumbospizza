'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Heart, Loader2, Star } from 'lucide-react';

export default function FavoritesTab() {
  const [loading, setLoading] = useState(true);
  const [favorites, setFavorites] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/customer/favorites')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setFavorites(d.favorites || []);
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

  if (favorites.length === 0) {
    return (
      <div className="rounded-lg bg-white p-6 text-center shadow sm:p-10">
        <Heart className="mx-auto mb-3 h-12 w-12 text-gray-300" />
        <p className="text-pretty text-gray-500">
          Noch keine Favoriten. Bestellen Sie etwas Leckeres!
        </p>
      </div>
    );
  }

  const hasHistory = favorites.some((f) => f.source === 'history');

  return (
    <div>
      {!hasHistory && (
        <p className="mb-4 text-pretty text-sm leading-6 text-gray-500">
          Noch wenig Bestellverlauf — hier sind beliebte Produkte:
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 min-[380px]:grid-cols-2 sm:grid-cols-3">
        {favorites.map((f) => (
          <div
            key={f.productId || f.name}
            className="overflow-hidden rounded-lg bg-white shadow transition-shadow hover:shadow-md"
          >
            <div className="relative aspect-square bg-gray-100">
              {f.image && (
                <Image
                  src={f.image}
                  alt={f.name}
                  fill
                  sizes="(max-width: 640px) 50vw, 200px"
                  className="object-cover"
                />
              )}
              {f.source === 'history' ? (
                <span className="absolute left-2 top-2 max-w-[calc(100%-1rem)] truncate rounded-full bg-primary-600 px-2 py-0.5 text-xs font-medium text-white">
                  {f.orderCount}× bestellt
                </span>
              ) : (
                <span className="absolute left-2 top-2 flex max-w-[calc(100%-1rem)] items-center truncate rounded-full bg-yellow-500 px-2 py-0.5 text-xs font-medium text-white">
                  <Star className="mr-1 h-3 w-3 shrink-0" /> Beliebt
                </span>
              )}
            </div>
            <div className="p-3">
              <h4 className="mb-2 line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-5 text-gray-900">
                {f.name}
              </h4>
              {f.productId ? (
                <Link
                  href={`/product/${f.productId}`}
                  className="block min-h-[34px] rounded-md bg-primary-600 px-3 py-2 text-center text-xs font-medium leading-none text-white hover:bg-primary-700"
                >
                  Erneut bestellen
                </Link>
              ) : (
                <span className="block min-h-[34px] rounded-md bg-gray-100 px-3 py-2 text-center text-xs leading-none text-gray-400">
                  Nicht verfügbar
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
