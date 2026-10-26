"use client";

import { CSSProperties, useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { emitHalloweenBats } from './bus';
import { playLaugh } from './sound';

/**
 * Горящая карточка (Halloween, только мышь): края обугливаются, снизу и по
 * бокам лижет пламя, летят искры, из карточки вылетают мыши, звучит смех.
 * Пламя держится по краям, чтобы название, цена и кнопка читались.
 */

// left — в % ширины карточки; угловые языки выше, центральные — у самой кромки.
const BOTTOM_FLAMES = [
  { left: -4, w: 32, h: 66 },
  { left: 7, w: 25, h: 42 },
  { left: 18, w: 20, h: 25 },
  { left: 30, w: 17, h: 16 },
  { left: 43, w: 16, h: 13 },
  { left: 56, w: 17, h: 16 },
  { left: 68, w: 20, h: 25 },
  { left: 79, w: 25, h: 42 },
  { left: 90, w: 32, h: 66 },
];
const SIDE_FLAMES = [
  { bottom: '12%', w: 19, h: 42 },
  { bottom: '25%', w: 16, h: 32 },
  { bottom: '38%', w: 13, h: 22 },
  { bottom: '50%', w: 9, h: 14 },
];
const EMBERS = [
  { left: 6, dx: -14, delay: 0, dur: 1.5 },
  { left: 18, dx: 10, delay: 0.5, dur: 1.8 },
  { left: 30, dx: -8, delay: 1.1, dur: 1.6 },
  { left: 47, dx: 12, delay: 0.3, dur: 1.9 },
  { left: 61, dx: -10, delay: 0.9, dur: 1.5 },
  { left: 74, dx: 8, delay: 0.2, dur: 1.7 },
  { left: 86, dx: -12, delay: 1.3, dur: 1.6 },
  { left: 95, dx: 6, delay: 0.7, dur: 1.8 },
];

const BAT_GAP_MS = 2000;

const FLAME_PATH = 'M10 0C12 9 19 14 19 26a9 9 0 0 1-18 0C1 18 6 15 7 7c1 4 3 6 4 7 0-5-1-9-1-14Z';
const CORE_PATH = 'M10 16c1 4 5 6.5 5 11a5 5 0 0 1-10 0c0-4.5 4-6.5 5-11Z';

const CHAR_STYLE: CSSProperties = {
  boxShadow:
    'inset 0 0 26px 8px rgba(18,6,0,.9), inset 0 0 70px 26px rgba(70,22,0,.38), inset 0 0 0 2px rgba(251,146,60,.55)',
  background:
    'radial-gradient(90% 38% at 50% 106%, rgba(255,110,20,.32), rgba(255,110,20,0) 70%), radial-gradient(120% 95% at 50% 42%, rgba(0,0,0,0) 55%, rgba(14,5,0,.5) 100%)',
};

const SMOKE_STYLE: CSSProperties = {
  background:
    'radial-gradient(30% 45% at 12% 100%, rgba(70,62,78,.55), rgba(70,62,78,0) 70%), radial-gradient(30% 45% at 88% 100%, rgba(70,62,78,.55), rgba(70,62,78,0) 70%), radial-gradient(40% 35% at 50% 100%, rgba(70,62,78,.35), rgba(70,62,78,0) 70%)',
};

function canHover() {
  try {
    return !!window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches;
  } catch {
    return false;
  }
}

function Flame({ gid, style }: { gid: string; style: CSSProperties }) {
  return (
    <svg className="hw-flame" viewBox="0 0 20 40" preserveAspectRatio="none" style={style}>
      <path d={FLAME_PATH} fill={`url(#${gid}-flame)`} />
      <path d={CORE_PATH} fill={`url(#${gid}-core)`} />
    </svg>
  );
}

const flameVars = (i: number) =>
  ({ '--hw-delay': `${-i * 0.17}s`, '--hw-dur': `${0.7 + (i % 3) * 0.18}s` }) as CSSProperties;

/**
 * suppressed — открыта модалка товара: React-события из её портала долетают
 * до карточки, поэтому наведение слушаем нативно на самой карточке.
 */
export default function CardFire({ suppressed = false }: { suppressed?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  // На тач-экранах «наведение» — это тап, который сразу открывает товар.
  const [hoverable] = useState(canHover);
  const [hovered, setHovered] = useState(false);
  const lastBatsAt = useRef(0);
  const wasLit = useRef(false);
  const [smoke, setSmoke] = useState(0);
  const gid = `hw${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const lit = hoverable && hovered && !suppressed;

  useEffect(() => {
    const card = rootRef.current?.parentElement;
    if (!card) return;
    const enter = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') setHovered(true);
    };
    const leave = () => setHovered(false);
    card.addEventListener('pointerenter', enter);
    card.addEventListener('pointerleave', leave);
    return () => {
      card.removeEventListener('pointerenter', enter);
      card.removeEventListener('pointerleave', leave);
    };
  }, [hoverable]);

  // После закрытия модалки карточка не вспыхивает сама — только при новом наведении.
  useEffect(() => {
    if (suppressed) setHovered(false);
  }, [suppressed]);

  useEffect(() => {
    if (lit && !wasLit.current) {
      const now = Date.now();
      if (now - lastBatsAt.current > BAT_GAP_MS) {
        lastBatsAt.current = now;
        emitHalloweenBats(rootRef.current);
      }
      playLaugh();
    }
    if (!lit && wasLit.current) setSmoke((n) => n + 1);
    wasLit.current = lit;
  }, [lit]);

  if (!hoverable) return null;

  return (
    <div ref={rootRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-[inherit]">
      <svg width="0" height="0" className="absolute">
        <defs>
          <linearGradient id={`${gid}-flame`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#ffe9a3" />
            <stop offset="0.3" stopColor="#ffab2e" />
            <stop offset="0.65" stopColor="#f2541b" />
            <stop offset="1" stopColor="#b3170c" stopOpacity="0.85" />
          </linearGradient>
          <linearGradient id={`${gid}-core`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#fffdf2" />
            <stop offset="1" stopColor="#ffd56b" />
          </linearGradient>
        </defs>
      </svg>

      <AnimatePresence>
        {lit && (
          <motion.div key="fire" className="absolute inset-0" initial="out" animate="in" exit="out">
            <motion.div
              className="absolute inset-0 rounded-[inherit]"
              style={CHAR_STYLE}
              variants={{ out: { opacity: 0 }, in: { opacity: 1 } }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
            <motion.div
              className="absolute inset-0"
              variants={{ out: { opacity: 0, y: 28 }, in: { opacity: 1, y: 0 } }}
              transition={{ type: 'spring', bounce: 0.25, visualDuration: 0.35 }}
            >
              {BOTTOM_FLAMES.map((f, i) => (
                <Flame
                  key={`b${i}`}
                  gid={gid}
                  style={{ left: `${f.left}%`, bottom: -6, width: f.w, height: f.h, ...flameVars(i) }}
                />
              ))}
              {SIDE_FLAMES.map((f, i) => (
                <Flame key={`l${i}`} gid={gid} style={{ left: -5, bottom: f.bottom, width: f.w, height: f.h, ...flameVars(i + 2) }} />
              ))}
              {SIDE_FLAMES.map((f, i) => (
                <Flame key={`r${i}`} gid={gid} style={{ right: -5, bottom: f.bottom, width: f.w, height: f.h, ...flameVars(i + 5) }} />
              ))}
              {EMBERS.map((e, i) => (
                <span
                  key={`e${i}`}
                  className="hw-ember"
                  style={{ left: `${e.left}%`, '--hw-dx': `${e.dx}px`, '--hw-delay': `${e.delay}s`, '--hw-dur': `${e.dur}s` } as CSSProperties}
                />
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Погасла — со дна карточки уходит струйка дыма */}
      <AnimatePresence>
        {smoke > 0 && !lit && (
          <motion.div
            key={smoke}
            className="absolute inset-x-0 bottom-0 h-1/2"
            style={SMOKE_STYLE}
            initial={{ opacity: 0.6, y: 0 }}
            animate={{ opacity: 0, y: -48 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.1, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
