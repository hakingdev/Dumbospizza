"use client";

import { useEffect, useRef } from 'react';
import { animate, motion, useAnimate, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { formatEuro } from '../lib/format-euro';

/**
 * Сумма, которая «досчитывается» до нового значения (13,90 → 17,90 €), а не
 * перескакивает. Число обновляется без ре-рендеров React — через MotionValue.
 */
export default function CountingAmount({ value, className = '' }: { value: number; className?: string }) {
  const amount = useMotionValue(value);
  const text = useTransform(() => formatEuro(amount.get()));
  const reduceMotion = useReducedMotion();
  const [scope, animateScope] = useAnimate();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      amount.set(value);
      return;
    }
    if (reduceMotion) {
      amount.set(value);
      return;
    }
    const grew = value > amount.get();
    const controls = animate(amount, value, { duration: 0.45, ease: [0.23, 1, 0.32, 1] });
    if (grew && scope.current) {
      animateScope(scope.current, { scale: [1, 1.12, 1] }, { duration: 0.35, ease: 'easeOut' });
    }
    return () => controls.stop();
  }, [value, amount, reduceMotion, scope, animateScope]);

  return (
    <motion.span ref={scope} className={`inline-block whitespace-nowrap tabular-nums ${className}`}>
      {text}
    </motion.span>
  );
}
