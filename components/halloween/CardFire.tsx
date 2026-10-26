"use client";

import { CSSProperties, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { emitHalloweenBats, HW_FLARE } from './bus';
import { extinguishCard, igniteCard } from './fire-gl';
import { playLaugh } from './sound';

/**
 * Горящая карточка (Halloween): вокруг карточки вырывается настоящее пламя
 * (WebGL, см. fire-gl.ts), края карточки темнеют от копоти и подсвечиваются
 * огнём, из неё вылетают мыши, звучит смех.
 *
 * Компьютер — горит, пока над карточкой мышь. Телефон — короткая вспышка от
 * тапа и у карточки в середине экрана, когда прокрутка остановилась: во время
 * самой прокрутки огонь не рисуем — видеокарта телефона занята прокруткой,
 * и огонь вместе с ней давал подёргивания (замер: без WebGL рывков нет).
 */

const BAT_GAP_MS = 2000;
// Телефон: при быстрой прокрутке карточки вспыхивают одна за другой — мышей реже.
const TOUCH_BATS_GAP_MS = 1500;
const TAP_FLARE_MS = 2000;
const SCROLL_FLARE_MS = 1600;
// Столько без событий scroll — и прокрутка считается остановившейся.
const SCROLL_IDLE_MS = 160;
const HW_SCROLL_START = 'hw:scrollstart';
const HW_SCROLL_END = 'hw:scrollend';

let lastTouchBatsAt = 0;
// Телефон: горит одна карточка — новая вспышка гасит предыдущую.
let stopActiveFlare: (() => void) | null = null;
let scrollTracking = false;
let scrolling = false;
let scrollIdleTimer: ReturnType<typeof setTimeout> | undefined;

/** Один слушатель scroll на страницу: сообщает карточкам о начале и конце прокрутки. */
function trackScroll() {
  if (scrollTracking) return;
  scrollTracking = true;
  window.addEventListener(
    'scroll',
    () => {
      if (!scrolling) {
        scrolling = true;
        window.dispatchEvent(new Event(HW_SCROLL_START));
      }
      clearTimeout(scrollIdleTimer);
      scrollIdleTimer = setTimeout(() => {
        scrolling = false;
        window.dispatchEvent(new Event(HW_SCROLL_END));
      }, SCROLL_IDLE_MS);
    },
    { passive: true }
  );
}

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
 * до карточки, поэтому наведение и тапы слушаем нативно на самой карточке.
 */
export default function CardFire({ suppressed = false }: { suppressed?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [hoverable] = useState(canHover);
  const [hovered, setHovered] = useState(false);
  const [flaring, setFlaring] = useState(false);
  const reduce = useReducedMotion();
  const lastBatsAt = useRef(0);
  const wasLit = useRef(false);
  // Погасить без затухания (снова началась прокрутка) — чтобы не рисовать огонь во время неё.
  const instantOut = useRef(false);
  const lit = !suppressed && (hoverable ? hovered : flaring);

  // Компьютер: поджигаем по настоящему движению мыши, а не по pointerenter —
  // при прокрутке колесом карточки сами проезжают под курсором.
  useEffect(() => {
    const card = rootRef.current?.parentElement;
    if (!card || !hoverable) return;
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

  // Телефон: вспышка от тапа и у карточки в середине экрана, когда прокрутка остановилась.
  useEffect(() => {
    const card = rootRef.current?.parentElement;
    if (!card || hoverable) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let burning = false;
    let inBand = false;
    const stop = () => {
      clearTimeout(timer);
      burning = false;
      setFlaring(false);
      if (stopActiveFlare === stop) stopActiveFlare = null;
    };
    const flare = (ms: number) => {
      burning = true;
      if (stopActiveFlare && stopActiveFlare !== stop) stopActiveFlare();
      stopActiveFlare = stop;
      clearTimeout(timer);
      setFlaring(true);
      timer = setTimeout(stop, ms);
    };
    // Тап по фото и «+» поджигает карточка-родитель (с паузой перед товаром).
    const onFlare = (e: Event) => flare((e as CustomEvent<number>).detail || TAP_FLARE_MS);
    const onClick = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest?.('button, a')) flare(TAP_FLARE_MS);
    };
    card.addEventListener(HW_FLARE, onFlare);
    card.addEventListener('click', onClick);

    trackScroll();
    const onScrollStart = () => {
      if (!burning) return;
      instantOut.current = true;
      stop();
    };
    const onScrollEnd = () => {
      if (inBand) flare(SCROLL_FLARE_MS);
    };
    window.addEventListener(HW_SCROLL_START, onScrollStart);
    window.addEventListener(HW_SCROLL_END, onScrollEnd);
    let io: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(
        (entries) => {
          inBand = entries[entries.length - 1].isIntersecting;
        },
        { rootMargin: '-45% 0px -45% 0px' }
      );
      io.observe(card);
    }
    return () => {
      clearTimeout(timer);
      if (stopActiveFlare === stop) stopActiveFlare = null;
      io?.disconnect();
      window.removeEventListener(HW_SCROLL_START, onScrollStart);
      window.removeEventListener(HW_SCROLL_END, onScrollEnd);
      card.removeEventListener(HW_FLARE, onFlare);
      card.removeEventListener('click', onClick);
      extinguishCard(card);
    };
  }, [hoverable]);

  // После закрытия модалки карточка не вспыхивает сама — только при новом наведении или тапе.
  useEffect(() => {
    if (!suppressed) return;
    setHovered(false);
    setFlaring(false);
  }, [suppressed]);

  useEffect(() => {
    const card = rootRef.current?.parentElement;
    if (!card) return;
    if (lit && !wasLit.current) {
      if (!reduce) igniteCard(card, { front: !hoverable });
      const now = Date.now();
      const touchReady = hoverable || now - lastTouchBatsAt > TOUCH_BATS_GAP_MS;
      if (now - lastBatsAt.current > BAT_GAP_MS && touchReady) {
        lastBatsAt.current = now;
        if (!hoverable) lastTouchBatsAt = now;
        emitHalloweenBats(card);
      }
      playLaugh();
    }
    // Открылся товар — гасим сразу, без затухания: телефон нужен окну товара.
    if (!lit && wasLit.current) extinguishCard(card, { instant: suppressed || instantOut.current });
    instantOut.current = false;
    wasLit.current = lit;
  }, [lit, reduce, hoverable, suppressed]);

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
