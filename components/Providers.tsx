"use client";

import { SessionProvider } from 'next-auth/react';
import { ReactNode } from 'react';
import { CartProvider } from '../lib/contexts/CartContext';
import { LanguageProvider } from '../lib/contexts/LanguageContext';
// Защита React от падений при авто-переводе страницы браузером (Google Translate).
// Импорт-сайд-эффект: патчит removeChild/insertBefore до первой реконсиляции.
import '../lib/google-translate-compat';

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <LanguageProvider>
        <CartProvider>
          {children}
        </CartProvider>
      </LanguageProvider>
    </SessionProvider>
  );
}


