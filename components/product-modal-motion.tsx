"use client";

import { useEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';

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

const ROLL = {
  enter: (dir: number) => ({ y: dir >= 0 ? '70%' : '-70%', opacity: 0 }),
  center: { y: 0, opacity: 1 },
  exit: (dir: number) => ({ y: dir >= 0 ? '-70%' : '70%', opacity: 0 }),
};

/**
 * Сумма на кнопке «In den Warenkorb»: новое значение въезжает снизу, если
 * выросло (добавили соус/топпинг), и сверху — если уменьшилось.
 */
export function RollingAmount({ value, text }: { value: number; text: string }) {
  const last = useRef(value);
  const direction = value >= last.current ? 1 : -1;
  useEffect(() => {
    last.current = value;
  }, [value]);

  return (
    <span className="relative inline-grid overflow-hidden align-bottom">
      <AnimatePresence initial={false} mode="popLayout" custom={direction}>
        <motion.span
          key={text}
          custom={direction}
          variants={ROLL}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ type: 'spring', visualDuration: 0.26, bounce: 0 }}
          className="inline-block whitespace-nowrap tabular-nums"
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
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
