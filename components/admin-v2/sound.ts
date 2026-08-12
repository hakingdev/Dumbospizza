'use client';

/**
 * Звук нового заказа: настройка в localStorage (через safe-storage,
 * см. mobile-crash-storage) + короткий сигнал Web Audio без аудиофайла.
 */

import { useEffect, useRef } from 'react';
import { storageGet, storageSet } from '../../lib/safe-storage';

const KEY = 'adminv2-new-order-sound';

export function isSoundEnabled(): boolean {
  return storageGet(KEY) !== '0';
}

export function setSoundEnabled(enabled: boolean): void {
  storageSet(KEY, enabled ? '1' : '0');
}

export function playNewOrderBeep(): void {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const play = (freq: number, at: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.4);
    };
    play(880, 0);
    play(1174.66, 0.18); // D6 — «динь-дон» новой смены
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch {
    // без звука — не критично
  }
}

/** Сигналит, когда количество заказов со статусом «new» выросло. */
export function useNewOrderAlert(newOrdersCount: number, ready: boolean): void {
  const prev = useRef<number | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (prev.current !== null && newOrdersCount > prev.current && isSoundEnabled()) {
      playNewOrderBeep();
    }
    prev.current = newOrdersCount;
  }, [newOrdersCount, ready]);
}
