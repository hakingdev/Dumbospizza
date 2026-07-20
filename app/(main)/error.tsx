"use client";

/**
 * Error boundary для витрины.
 *
 * До этого файла в проекте не было НИ ОДНОГО error.tsx: любой бросок в любом
 * клиентском компоненте (упавший эффект слайдера, недоступный localStorage)
 * заменял всю страницу дефолтной заглушкой Next.js «Application error:
 * a client-side exception has occurred» — белый экран вместо магазина.
 *
 * Здесь ошибка локализуется в сегменте (main): хедер, футер и навигация
 * остаются на месте, посетитель может уйти в меню и оформить заказ.
 *
 * ВАЖНО: этот компонент не должен зависеть от контекстов приложения
 * (язык, корзина) — они могут быть как раз тем, что упало. Только чистый JSX.
 */

import { useEffect } from 'react';
import Link from 'next/link';

export default function StorefrontError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[storefront] Unbehandelter Fehler:', error);
  }, [error]);

  // Испорченная корзина в localStorage — одна из причин падения, поэтому даём
  // посетителю самостоятельный выход, не дожидаясь «почистите данные сайта».
  const resetLocalData = () => {
    try {
      window.localStorage.removeItem('pizza-cart');
    } catch {
      // storage недоступен — значит и портиться было нечему
    }
    window.location.reload();
  };

  return (
    <main className="flex min-h-[60vh] items-center justify-center bg-gray-50 px-4 py-16">
      <div className="w-full max-w-md text-center">
        <div className="mb-4 text-5xl">🍕</div>
        <h1 className="mb-2 text-2xl font-bold text-gray-900">
          Da ist etwas schiefgelaufen
        </h1>
        <p className="mb-6 text-gray-600">
          Diese Seite konnte nicht geladen werden. Bitte versuchen Sie es erneut — Ihre
          Bestellung können Sie auch telefonisch aufgeben.
        </p>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-primary-600 px-6 py-3 font-bold text-white shadow-md transition hover:bg-primary-700"
          >
            Erneut versuchen
          </button>
          <Link
            href="/menu"
            className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-gray-300 bg-white px-6 py-3 font-bold text-gray-700 transition hover:bg-gray-50"
          >
            Zur Speisekarte
          </Link>
        </div>

        <button
          type="button"
          onClick={resetLocalData}
          className="mt-4 text-sm text-gray-500 underline"
        >
          Warenkorb zurücksetzen und neu laden
        </button>

        {error.digest && (
          <p className="mt-6 text-xs text-gray-400">Fehler-ID: {error.digest}</p>
        )}
      </div>
    </main>
  );
}
