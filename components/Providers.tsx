"use client";

import { SessionProvider } from 'next-auth/react';
import { ReactNode } from 'react';
import { MotionConfig } from 'motion/react';
import { CartProvider } from '../lib/contexts/CartContext';
import { KitchenBlocksProvider } from '../lib/contexts/KitchenBlocksContext';
import { LanguageProvider } from '../lib/contexts/LanguageContext';
import { HalloweenProvider } from './halloween/HalloweenProvider';
// Защита React от падений при авто-переводе страницы браузером (Google Translate).
// Импорт-сайд-эффект: патчит removeChild/insertBefore до первой реконсиляции.
import '../lib/google-translate-compat';

export default function Providers({ children, halloween = false }: { children: ReactNode; halloween?: boolean }) {
  return (
    <SessionProvider>
      <LanguageProvider>
        <CartProvider>
          {/* Стоп цеха (стоп-бот): карточки, страница товара и чекаут берут состояние отсюда. */}
          <KitchenBlocksProvider>
            {/* «Уменьшить движение» в ОС: Motion гасит сдвиги/масштаб, оставляя прозрачность. */}
            <MotionConfig reducedMotion="user">
              <HalloweenProvider enabled={halloween}>{children}</HalloweenProvider>
            </MotionConfig>
          </KitchenBlocksProvider>
        </CartProvider>
      </LanguageProvider>
    </SessionProvider>
  );
}


