"use client";

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Bat } from './Bat';
import { HW_BATS, HW_DRIP, type HalloweenRect } from './bus';
import { handleVisibility, setMusicZone, tryAutoplay, unlockAudio } from './sound';
import { extinguishAll } from './fire-gl';

/**
 * Слой эффектов ночной витрины: фоновая стайка мышей, мыши из горящей
 * карточки и капли крови с кнопок «в корзину». Монтируется только на
 * витринных страницах при включённом Halloween-режиме.
 */

type Flight = {
  id: number;
  size: number;
  x: number[];
  y: number[];
  rotate: number[];
  delay: number;
  duration: number;
};

type Drip = { id: number; x: number; y: number };

let seq = 0;
const rand = (min: number, max: number) => min + Math.random() * (max - min);

const FLOCK_FIRST_MS = 1200;
const FLOCK_EVERY_MS = 40_000;
const DRIP_LIFETIME_MS = 3200;

function makeFlock(): Flight[] {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const ltr = Math.random() < 0.5;
  const baseY = rand(0.14, 0.34) * h;
  const count = 3 + Math.floor(Math.random() * 3);
  const startX = ltr ? -90 : w + 90;
  const endX = ltr ? w + 90 : -90;
  return Array.from({ length: count }, (_, i) => {
    const y0 = baseY + rand(-50, 50);
    const amp = rand(18, 42);
    const climb = rand(20, 80);
    const steps = [0, 0.25, 0.5, 0.75, 1];
    return {
      id: ++seq,
      size: rand(28, 44),
      x: steps.map((t) => startX + (endX - startX) * t),
      y: steps.map((t, k) => y0 + Math.sin(k * 1.9 + i) * amp - t * climb),
      rotate: ltr ? [8, -6, 8, -6, 4] : [-8, 6, -8, 6, -4],
      delay: i * rand(0.15, 0.4),
      duration: rand(5.5, 8),
    };
  });
}

function makeBurst(r: HalloweenRect): Flight[] {
  const count = Math.random() < 0.5 ? 2 : 3;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height * 0.3;
  return Array.from({ length: count }, (_, i) => {
    const dir = i % 2 === 0 ? -1 : 1;
    const size = rand(26, 36);
    const dx = dir * rand(150, 270);
    const dy = -rand(170, 290);
    const x0 = cx - size / 2 + rand(-30, 30);
    return {
      id: ++seq,
      size,
      x: [x0, x0 + dx * 0.4, x0 + dx],
      y: [cy, cy + dy * 0.55, cy + dy],
      rotate: [0, dir * -16, dir * 10],
      delay: i * 0.09,
      duration: rand(1.1, 1.5),
    };
  });
}

function FlyingBat({ flight, onDone, burst }: { flight: Flight; onDone: () => void; burst?: boolean }) {
  return (
    <motion.div
      className="absolute left-0 top-0"
      initial={{ x: flight.x[0], y: flight.y[0], opacity: 0, scale: burst ? 0.4 : 1 }}
      animate={{
        x: flight.x,
        y: flight.y,
        rotate: flight.rotate,
        opacity: burst ? [0, 1, 1, 0] : [0, 1, 1, 1, 0],
        scale: burst ? [0.4, 1, 0.9] : 1,
      }}
      transition={{ duration: flight.duration, delay: flight.delay, ease: burst ? 'easeOut' : 'linear' }}
      onAnimationComplete={onDone}
    >
      <Bat size={flight.size} flap={burst ? 0.14 : 0.22} />
    </motion.div>
  );
}

function Bats() {
  const reduce = useReducedMotion();
  const [flights, setFlights] = useState<(Flight & { burst?: boolean })[]>([]);

  useEffect(() => {
    // «Уменьшить движение»: не летаем, мыши остаются только на луне в hero.
    if (reduce) return;
    let timer: ReturnType<typeof setTimeout>;
    const launch = () => {
      if (!document.hidden) setFlights((list) => [...list, ...makeFlock()]);
      timer = setTimeout(launch, FLOCK_EVERY_MS + rand(-4000, 4000));
    };
    timer = setTimeout(launch, FLOCK_FIRST_MS);

    const onBats = (e: Event) => {
      const burst = makeBurst((e as CustomEvent<HalloweenRect>).detail).map((f) => ({ ...f, burst: true }));
      setFlights((list) => [...list, ...burst]);
    };
    window.addEventListener(HW_BATS, onBats);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(HW_BATS, onBats);
    };
  }, [reduce]);

  if (reduce) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[45] overflow-hidden" aria-hidden="true">
      {flights.map((f) => (
        <FlyingBat
          key={f.id}
          flight={f}
          burst={f.burst}
          onDone={() => setFlights((list) => list.filter((x) => x.id !== f.id))}
        />
      ))}
    </div>
  );
}

const DROP_PATH = 'M6 0C6 4 11 8.5 11 12.5A5 5 0 0 1 1 12.5C1 8.5 6 4 6 0Z';
const SMEAR_PATH =
  'M0 0H18C16 0 15 2 14.5 4.5C14 7 12.5 8 11.5 6.5C10.8 5.4 10.6 3 9 3C7.4 3 7.2 6.8 5.6 7.4C4 8 3.6 5 3 3C2.5 1.4 1.5 0 0 0Z';

function BloodDrop({ drip }: { drip: Drip }) {
  const reduce = useReducedMotion();
  const gid = `hw-blood-${drip.id}`;
  return (
    <div className="absolute" style={{ left: drip.x, top: drip.y }}>
      <svg width="0" height="0" className="absolute">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7a0711" />
            <stop offset="0.55" stopColor="#c1121f" />
            <stop offset="1" stopColor="#8f0a17" />
          </linearGradient>
        </defs>
      </svg>
      {/* подтёк на кромке кнопки — тает за 2–3 с */}
      <motion.svg
        width="30"
        height="16"
        viewBox="0 0 18 10"
        className="absolute -left-[5px] top-0"
        style={{ originY: 0 }}
        initial={{ scaleY: 0, opacity: 1 }}
        animate={{ scaleY: [0, 1, 1], opacity: [1, 1, 0] }}
        transition={{ duration: 2.9, times: [0, 0.1, 1], ease: 'easeOut' }}
      >
        <path d={SMEAR_PATH} fill={`url(#${gid})`} />
      </motion.svg>
      {/* капля: набухает, висит, вытягивается и срывается вниз */}
      <motion.svg
        width="20"
        height="30"
        viewBox="0 0 12 18"
        className="absolute left-0 top-[6px]"
        style={{ originY: 0 }}
        // «Уменьшить движение»: капля просто проявляется на кромке и гаснет, не падая.
        initial={reduce ? { opacity: 0 } : { scaleX: 0, scaleY: 0, y: 0, opacity: 1 }}
        animate={
          reduce
            ? { opacity: [0, 1, 1, 0] }
            : {
                scaleX: [0, 1, 0.9, 0.8],
                scaleY: [0, 1, 1.3, 1.15],
                y: [0, 2, 8, 150],
                opacity: [1, 1, 1, 0],
              }
        }
        transition={
          reduce
            ? { duration: 1.8, times: [0, 0.15, 0.75, 1] }
            : { duration: 1.2, times: [0, 0.22, 0.55, 1], ease: ['easeOut', 'easeInOut', 'easeIn'] }
        }
      >
        <path d={DROP_PATH} fill={`url(#${gid})`} />
        <ellipse cx="4.1" cy="12.2" rx="1.2" ry="2" fill="#fff" opacity="0.55" />
      </motion.svg>
    </div>
  );
}

function Drips() {
  const [drips, setDrips] = useState<Drip[]>([]);

  useEffect(() => {
    const onDrip = (e: Event) => {
      const r = (e as CustomEvent<HalloweenRect>).detail;
      const drip = { id: ++seq, x: r.right - 36, y: r.bottom - 3 };
      setDrips((list) => [...list, drip]);
      setTimeout(() => setDrips((list) => list.filter((d) => d.id !== drip.id)), DRIP_LIFETIME_MS);
    };
    window.addEventListener(HW_DRIP, onDrip);
    return () => window.removeEventListener(HW_DRIP, onDrip);
  }, []);

  // Выше модалки товара (z-50): капля висит на её кнопке, пока модалка закрывается.
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden" aria-hidden="true">
      {drips.map((d) => (
        <BloodDrop key={d.id} drip={d} />
      ))}
    </div>
  );
}

function useAudioLifecycle() {
  useEffect(() => {
    const events = ['pointerdown', 'touchend', 'click', 'keydown'] as const;
    let done = false;
    const remove = () => events.forEach((ev) => window.removeEventListener(ev, unlock, true));
    function unlock(e: Event) {
      // Клик по кнопке музыки она обрабатывает сама: иначе первый же клик
      // «включить» сначала запустил бы вальс, а потом кнопка его выключила.
      if (done || (e.target as Element | null)?.closest?.('[data-hw-sound]')) return;
      unlockAudio().then((running) => {
        if (running && !done) {
          done = true;
          remove();
        }
      });
    }
    events.forEach((ev) => window.addEventListener(ev, unlock, { capture: true, passive: true }));
    setMusicZone(true);
    tryAutoplay();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      done = true;
      remove();
      setMusicZone(false);
      extinguishAll();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);
}

export default function HalloweenLayer() {
  useAudioLifecycle();
  return (
    <>
      <Bats />
      <Drips />
    </>
  );
}
