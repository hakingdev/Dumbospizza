"use client";

import { createContext, ReactNode, useContext, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { isHalloweenNightPath } from '../../lib/halloween/config';

type HalloweenState = {
  /** Флаг из админки: ночные шапка, подвал и 🎃 в логотипе. */
  enabled: boolean;
  /** Витринная страница: тёмный фон, мыши, огонь, кровь, звук. */
  night: boolean;
};

const HalloweenContext = createContext<HalloweenState>({ enabled: false, night: false });

// Эффекты грузятся отдельным чанком и только при включённом режиме.
const HalloweenLayer = dynamic(() => import('./HalloweenLayer'), { ssr: false });

export function HalloweenProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const night = enabled && isHalloweenNightPath(pathname);

  useEffect(() => {
    const root = document.documentElement;
    if (night) root.setAttribute('data-hw-zone', 'night');
    else root.removeAttribute('data-hw-zone');
  }, [night]);

  const value = useMemo(() => ({ enabled, night }), [enabled, night]);

  return (
    <HalloweenContext.Provider value={value}>
      {children}
      {night && <HalloweenLayer />}
    </HalloweenContext.Provider>
  );
}

export function useHalloween() {
  return useContext(HalloweenContext);
}
