"use client";

import { CSSProperties, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { emitHalloweenBats } from './bus';
import { extinguishCard, igniteCard } from './fire-gl';
import { playLaugh } from './sound';

/**
 * Горящая карточка (Halloween, только мышь): из-за краёв карточки вырывается
 * настоящее пламя (WebGL, см. fire-gl.ts), края карточки темнеют от копоти и
 * подсвечиваются огнём, из неё вылетают мыши, звучит смех.
 */

const BAT_GAP_MS = 2000;

// Копоть по краям и отсвет огня снизу; середина с названием и ценой чистая.
const SOOT_STYLE: CSSProperties = {
  boxShadow: 'inset 0 0 22px 4px rgba(24,10,2,.55), inset 0 -18px 36px -8px rgba(255,110,20,.4)',
};
// «Уменьшить движение»: без пламени — ровное тёплое свечение.
const STILL_GLOW_STYLE: CSSProperties = {
  boxShadow:
    'inset 0 0 22px 4px rgba(24,10,2,.55), inset 0 0 0 2px rgba(251,146,60,.7), inset 0 -24px 40px -6px rgba(255,110,20,.5)',
};

function canHover() {
  try {
    return !!window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches;
  } catch {
    return false;
  }
}

/**
 * suppressed — открыта модалка товара: React-события из её портала долетают
 * до карточки, поэтому наведение слушаем нативно на самой карточке.
 */
export default function CardFire({ suppressed = false }: { suppressed?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  // На тач-экранах «наведение» — это тап, который сразу открывает товар.
  const [hoverable] = useState(canHover);
  const [hovered, setHovered] = useState(false);
  const reduce = useReducedMotion();
  const lastBatsAt = useRef(0);
  const wasLit = useRef(false);
  const lit = hoverable && hovered && !suppressed;

  useEffect(() => {
    const card = rootRef.current?.parentElement;
    if (!card) return;
    // Поджигаем по настоящему движению мыши, а не по pointerenter: при прокрутке
    // колесом карточки сами проезжают под курсором и вспыхивали бы случайно.
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && (e.movementX || e.movementY)) setHovered(true);
    };
    const leave = () => setHovered(false);
    card.addEventListener('pointermove', move);
    card.addEventListener('pointerleave', leave);
    return () => {
      card.removeEventListener('pointermove', move);
      card.removeEventListener('pointerleave', leave);
      extinguishCard(card);
    };
  }, [hoverable]);

  // После закрытия модалки карточка не вспыхивает сама — только при новом наведении.
  useEffect(() => {
    if (suppressed) setHovered(false);
  }, [suppressed]);

  useEffect(() => {
    const card = rootRef.current?.parentElement;
    if (!card) return;
    if (lit && !wasLit.current) {
      if (!reduce) igniteCard(card);
      const now = Date.now();
      if (now - lastBatsAt.current > BAT_GAP_MS) {
        lastBatsAt.current = now;
        emitHalloweenBats(card);
      }
      playLaugh();
    }
    if (!lit && wasLit.current) extinguishCard(card);
    wasLit.current = lit;
  }, [lit, reduce]);

  if (!hoverable) return null;

  return (
    <div ref={rootRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-[inherit]">
      <AnimatePresence>
        {lit && (
          <motion.div
            key="soot"
            className="absolute inset-0 rounded-[inherit]"
            style={reduce ? STILL_GLOW_STYLE : SOOT_STYLE}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.6, ease: 'easeIn' } }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
