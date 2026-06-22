"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';

const STORAGE_KEY = 'cookie-consent';

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      setVisible(true);
    }
  }, []);

  const handleAccept = () => {
    window.localStorage.setItem(STORAGE_KEY, 'accepted');
    setVisible(false);
  };

  const handleDecline = () => {
    window.localStorage.setItem(STORAGE_KEY, 'declined');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 bg-white border-t border-gray-200 shadow-lg">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 text-sm leading-relaxed text-gray-700">
          Wir verwenden Cookies, um unsere Website bereitzustellen und Ihr Nutzererlebnis zu verbessern.
          Mehr Informationen finden Sie in unserer{' '}
          <Link href="/datenschutz" className="text-primary-600 underline">
            Datenschutzerklärung
          </Link>
          .
        </div>
        <div className="grid w-full grid-cols-2 items-center gap-2 sm:flex sm:w-auto">
          <button
            type="button"
            onClick={handleDecline}
            className="inline-flex min-h-[42px] items-center justify-center whitespace-nowrap rounded-md border border-gray-300 px-4 py-2 text-center text-sm font-medium leading-tight text-gray-700 hover:bg-gray-50 sm:min-w-[112px]"
          >
            Ablehnen
          </button>
          <button
            type="button"
            onClick={handleAccept}
            className="inline-flex min-h-[42px] items-center justify-center whitespace-nowrap rounded-md bg-primary-600 px-4 py-2 text-center text-sm font-medium leading-tight text-white hover:bg-primary-700 sm:min-w-[142px]"
          >
            Alle akzeptieren
          </button>
        </div>
      </div>
    </div>
  );
}
