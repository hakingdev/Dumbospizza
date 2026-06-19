"use client";

import { SessionProvider } from 'next-auth/react';
import { ReactNode } from 'react';
import { CartProvider } from '../lib/contexts/CartContext';
import { LanguageProvider } from '../lib/contexts/LanguageContext';

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


