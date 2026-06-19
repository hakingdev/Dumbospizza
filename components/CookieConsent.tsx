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
      <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="text-sm text-gray-700">
          Wir verwenden Cookies, um unsere Website bereitzustellen und Ihr Nutzererlebnis zu verbessern.
          Mehr Informationen finden Sie in unserer{' '}
          <Link href="/datenschutz" className="text-primary-600 underline">
            Datenschutzerklärung
          </Link>
          .
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDecline}
            className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm"
          >
            Ablehnen
          </button>
          <button
            type="button"
            onClick={handleAccept}
            className="px-4 py-2 rounded-md bg-primary-600 text-white hover:bg-primary-700 text-sm"
          >
            Alle akzeptieren
          </button>
        </div>
      </div>
    </div>
  );
}

