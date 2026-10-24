"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion, useAnimate, useReducedMotion } from 'motion/react';
import { makeParticles, particleStyleFor, type Particle } from '../lib/topping-particles';

const POP = { type: 'spring', visualDuration: 0.22, bounce: 0.45 } as const;

/** Отметка выбора (точка радио, галочка, бейдж) — «вщёлкивается» при выборе. */
export function SelectionPop({
  show,
  className,
  children,
}: {
  show: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.span
          key="selected"
          className={className}
          initial={{ scale: 0.3, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.3, opacity: 0, transition: { duration: 0.12 } }}
          transition={POP}
        >
          {children}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** «+0,50 €» над кнопкой: всплывает и гаснет, когда добавили платный экстра. */
export function AddedDeltaChip({ id, text }: { id: number; text: string | null }) {
  return (
    <AnimatePresence>
      {text && (
        <motion.span
          key={id}
          aria-hidden="true"
          className="pointer-events-none absolute -top-4 right-6 rounded-full bg-primary-600 px-2.5 py-1 text-sm font-bold tabular-nums text-white shadow-md"
          initial={{ opacity: 0, y: 8, scale: 0.9 }}
          animate={{ opacity: 1, y: -6, scale: 1 }}
          exit={{ opacity: 0, y: -18, transition: { duration: 0.25 } }}
          transition={{ type: 'spring', visualDuration: 0.3, bounce: 0.3 }}
        >
          {text}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

const PARTICLE_SIZE: Record<Particle['shape'], CSSProperties> = {
  shred: { width: 5, height: 16, borderRadius: 9999 },
  disc: { width: 11, height: 11, borderRadius: 9999 },
  ring: { width: 11, height: 11, borderRadius: 9999, background: 'transparent', borderWidth: 2.5, borderStyle: 'solid' },
  bit: { width: 7, height: 5, borderRadius: 2 },
  drop: { width: 7, height: 9, borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%' },
  chunk: { width: 8, height: 7, borderRadius: 3 },
};

// Центр кусочка — в точке приземления. Отступами, а не translate-классами:
// transform целиком принадлежит Motion (падение, поворот).
function particleStyle(p: Particle): CSSProperties {
  const base = PARTICLE_SIZE[p.shape];
  const place: CSSProperties = {
    left: `${p.left}%`,
    top: `${p.top}%`,
    marginLeft: -Number(base.width) / 2,
    marginTop: -Number(base.height) / 2,
  };
  return p.shape === 'ring'
    ? { ...base, ...place, borderColor: p.color }
    : { ...base, ...place, background: p.color };
}

/**
 * Фото пиццы в окне товара: при наведении слегка поворачивается, а когда гость
 * выбирает добавку, на неё сыплются кусочки (сыр, салями, зелень…) и пицца
 * чуть «пружинит» в момент приземления.
 */
export function PizzaStage({
  burst,
  className = '',
  children,
}: {
  /** Новый id — новая порция кусочков; name выбирает их вид. */
  burst: { id: number; name: string } | null;
  className?: string;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const [bursts, setBursts] = useState<Array<{ id: number; particles: Particle[] }>>([]);
  const [bumpScope, animateBump] = useAnimate();
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!burst || reduceMotion) return;
    const style = particleStyleFor(burst.name);
    if (!style) return;
    const rect = stageRef.current?.getBoundingClientRect();
    const box = { width: rect?.width || 300, height: rect?.height || 300 };
    setBursts((list) => [...list.slice(-2), { id: burst.id, particles: makeParticles(style, box) }]);
    if (bumpScope.current) {
      animateBump(bumpScope.current, { scale: [1, 0.975, 1.015, 1] }, { duration: 0.45, delay: 0.32, ease: 'easeOut' });
    }
    const timer = setTimeout(() => {
      setBursts((list) => list.filter((b) => b.id !== burst.id));
    }, 1600);
    return () => clearTimeout(timer);
  }, [burst, reduceMotion, bumpScope, animateBump]);

  return (
    <div ref={stageRef} className={`relative overflow-hidden ${className}`}>
      <motion.div
        whileHover={{ rotate: 6, scale: 1.06 }}
        transition={{ type: 'spring', visualDuration: 0.5, bounce: 0.25 }}
      >
        <div ref={bumpScope}>{children}</div>
      </motion.div>
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        {bursts.map((b) =>
          b.particles.map((p, i) => (
            <motion.span
              key={`${b.id}-${i}`}
              className="absolute shadow-sm"
              style={particleStyle(p)}
              initial={{ y: -p.fall, rotate: 0, opacity: 0, scale: 0.9 }}
              animate={{
                y: [-p.fall, 0, 0],
                rotate: [0, p.spin, p.spin],
                opacity: [0, 1, 1, 0],
                scale: [0.9, 1.15, 1, 1],
              }}
              transition={{
                duration: 1.25,
                delay: p.delay,
                times: [0, 0.3, 1],
                opacity: { duration: 1.25, delay: p.delay, times: [0, 0.12, 0.7, 1] },
                scale: { duration: 1.25, delay: p.delay, times: [0, 0.3, 0.42, 1] },
                ease: ['easeIn', 'linear'],
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
