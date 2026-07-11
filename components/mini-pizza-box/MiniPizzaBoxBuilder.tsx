"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'framer-motion';
import { Check, ChevronLeft, ChevronRight, Plus, ShoppingCart, X } from 'lucide-react';
import { useCart } from '../../lib/contexts/CartContext';
import { normalizeObjectId } from '../../lib/normalize-id';
import { MINI_BOX_SLOTS, isMiniSize } from '../../lib/mini-pizza-box';
import { SafeImage } from '../SafeImage';
import { NoTranslate } from '../NoTranslate';

/**
 * 4er Mini Pizza Box — Vollbild-Konfigurator im «Reels»-Format (9:16-Spalte).
 *
 * Ablauf: Sorten-Karussell (Swipe/Пfeile) → Tap «In die Box» → die Mini-Pizza
 * fliegt im Bogen in den nächsten freien Slot der 2×2-Schachtel. Bei 4/4 klappt
 * der Deckel zu und der Gesamtpreis (= Summe der 4 Mini-Preise) wird gestempelt.
 *
 * Der Warenkorb bekommt EINE Position (Box-Produkt) mit den 4 Sorten als
 * `options` — Kasse, Bon und Telegram rendern das bereits (Optionsgruppen-Pfad).
 */

const money = (n: number) =>
  n.toFixed(2).replace('.', ',').replace(/,00$/, '') + ' €';

interface MiniSort {
  id: string;
  name: string;
  description: string;
  image?: string;
  /** Preis der Mini-Größe (18 cm) dieser Sorte */
  price: number;
}

interface BoxSlot {
  key: string;
  sort: MiniSort;
}

interface MiniPizzaBoxBuilderProps {
  isOpen: boolean;
  onClose: () => void;
  /** Das Box-Produkt (einzige Karte der Kategorie mini-pizza-box) */
  product: {
    id: string;
    name: string;
    image?: string;
    categoryId?: string;
  };
}

interface FlyingPizza {
  sort: MiniSort;
  from: DOMRect;
  to: DOMRect;
}

/** Runde Pizza-Scheibe (Foto kreisförmig beschnitten). */
function PizzaDisc({ sort, className }: { sort: MiniSort; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-full bg-amber-100 shadow-2xl ring-2 ring-white/20 ${className || ''}`}>
      {sort.image ? (
        <SafeImage src={sort.image} alt={sort.name} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-4xl">🍕</div>
      )}
    </div>
  );
}

export function MiniPizzaBoxBuilder({ isOpen, onClose, product }: MiniPizzaBoxBuilderProps) {
  const { addItem } = useCart();
  const reduceMotion = useReducedMotion();

  const [sorts, setSorts] = useState<MiniSort[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [[activeIndex, direction], setPage] = useState<[number, number]>([0, 0]);
  const [slots, setSlots] = useState<BoxSlot[]>([]);
  const [flying, setFlying] = useState<FlyingPizza | null>(null);
  const [lidReopened, setLidReopened] = useState(false);
  const [added, setAdded] = useState(false);
  const [fetchAttempt, setFetchAttempt] = useState(0);

  const pizzaImgRef = useRef<HTMLDivElement | null>(null);
  const slotRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const boxControls = useAnimationControls();

  // Sorten laden: alle verfügbaren Pizzen mit Mini-Größe (18 cm).
  useEffect(() => {
    if (!isOpen || sorts.length > 0) return;
    setError(false);
    let active = true;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/products?category=pizza&available=true&limit=500');
        const data = await res.json();
        if (!active) return;
        if (!data.success) {
          setError(true);
          return;
        }
        const list: MiniSort[] = (data.products || [])
          .map((p: any) => {
            const mini = (p.sizes || []).find((s: any) => s?.active !== false && isMiniSize(s));
            if (!mini) return null;
            return {
              id: p._id || p.id,
              name: p.name,
              description: p.description || '',
              image: p.image,
              price: Number(mini.price) || 0,
            } as MiniSort;
          })
          .filter((s: MiniSort | null): s is MiniSort => Boolean(s))
          .sort((a: MiniSort, b: MiniSort) => a.name.localeCompare(b.name));
        setSorts(list);
        if (list.length === 0) setError(true);
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [isOpen, sorts.length, fetchAttempt]);

  // ESC schließt, Hintergrund scrollt nicht.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) setAdded(false);
  }, [isOpen]);

  const activeSortIndex =
    sorts.length > 0 ? ((activeIndex % sorts.length) + sorts.length) % sorts.length : 0;
  const activeSort = sorts[activeSortIndex] ?? null;
  const complete = slots.length >= MINI_BOX_SLOTS;
  const lidClosed = complete && !lidReopened;
  const total = useMemo(() => slots.reduce((sum, s) => sum + s.sort.price, 0), [slots]);

  const paginate = (dir: number) => setPage(([index]) => [index + dir, dir]);

  /** Direkt zu einer Sorte springen (Thumbnail-Leiste). */
  const jumpToSort = (target: number) => {
    if (target === activeSortIndex) return;
    setPage(([index]) => [index + (target - activeSortIndex), target > activeSortIndex ? 1 : -1]);
  };

  // Aktive Sorte in der Thumbnail-Leiste sichtbar halten.
  const thumbRailRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = thumbRailRef.current?.querySelector<HTMLElement>(
      `[data-sort-index="${activeSortIndex}"]`
    );
    el?.scrollIntoView?.({
      inline: 'center',
      block: 'nearest',
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  }, [activeSortIndex, reduceMotion]);

  const bumpBox = useCallback(() => {
    if (reduceMotion) return;
    boxControls.start({
      scale: [1, 1.04, 1],
      rotate: [0, -1.5, 1.5, 0],
      transition: { duration: 0.35 },
    });
  }, [boxControls, reduceMotion]);

  const commitSlot = useCallback((sort: MiniSort) => {
    setSlots((prev) => {
      if (prev.length >= MINI_BOX_SLOTS) return prev;
      return [...prev, { key: `${sort.id}-${Date.now()}-${prev.length}`, sort }];
    });
    setAdded(false);
  }, []);

  const handleAddToBox = () => {
    if (!activeSort || complete || flying) return;
    const fromRect = pizzaImgRef.current?.getBoundingClientRect();
    const toRect = slotRefs.current[slots.length]?.getBoundingClientRect();
    // Ohne messbare Geometrie (reduzierte Bewegung, jsdom) direkt einlegen.
    if (reduceMotion || !fromRect || !toRect || fromRect.width === 0 || toRect.width === 0) {
      commitSlot(activeSort);
      return;
    }
    setFlying({ sort: activeSort, from: fromRect, to: toRect });
  };

  const removeSlot = (key: string) => {
    setSlots((prev) => prev.filter((s) => s.key !== key));
    setLidReopened(false);
    setAdded(false);
  };

  const handleAddToCart = () => {
    if (!complete || added) return;
    const boxId = `minibox-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    addItem({
      id: boxId,
      productId: product.id,
      categoryId: normalizeObjectId(product.categoryId),
      name: product.name,
      price: total,
      basePrice: total,
      quantity: 1,
      image: product.image,
      options: slots.map((s) => ({
        group: 'Mini Pizza ca. 18 cm',
        name: s.sort.name,
        price: s.sort.price,
      })),
    });
    setAdded(true);
  };

  const resetBox = () => {
    setSlots([]);
    setLidReopened(false);
    setAdded(false);
  };

  if (!isOpen) return null;

  const slideVariants = {
    enter: (dir: number) => ({ x: dir >= 0 ? 280 : -280, opacity: 0, scale: 0.6 }),
    center: { x: 0, opacity: 1, scale: 1 },
    exit: (dir: number) => ({ x: dir >= 0 ? -280 : 280, opacity: 0, scale: 0.6 }),
  };

  // Flugbahn: Klon startet auf dem Karussell-Bild und landet im nächsten freien Slot
  // (transformOrigin top-left → Ziel = Delta der Rechteck-Ecken, Größe über scale).
  const fly = flying
    ? {
        dx: flying.to.left - flying.from.left,
        dy: flying.to.top - flying.from.top,
        scale: flying.to.width / flying.from.width,
      }
    : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={product.name}
      className="fixed inset-0 z-[60] flex justify-center bg-gradient-to-b from-neutral-950 via-black to-neutral-900"
    >
      {/* Dekor: weiche Farbkleckse wie ein Reels-Hintergrund */}
      <div className="pointer-events-none absolute -left-24 top-16 h-72 w-72 rounded-full bg-primary-600/25 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-24 h-72 w-72 rounded-full bg-amber-500/20 blur-3xl" />

      <div className="relative flex h-full w-full max-w-[430px] flex-col px-4 pb-4 pt-3 text-white">
        {/* Story-Progress: 4 Segmente = 4 Slots */}
        <div className="mb-2 flex gap-1.5" aria-label={`${slots.length} von ${MINI_BOX_SLOTS} gewählt`}>
          {Array.from({ length: MINI_BOX_SLOTS }).map((_, i) => (
            <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
              <motion.div
                className="h-full rounded-full bg-white"
                initial={false}
                animate={{ width: i < slots.length ? '100%' : '0%' }}
                transition={{ duration: reduceMotion ? 0 : 0.35 }}
              />
            </div>
          ))}
        </div>

        {/* Kopfzeile */}
        <div className="mb-1 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-base font-extrabold leading-tight">
              <NoTranslate>{product.name}</NoTranslate>
            </p>
            <p className="text-xs font-medium text-white/60">
              4× Mini · ca. Ø 18 cm · {slots.length}/{MINI_BOX_SLOTS}
            </p>
          </div>
          <button
            type="button"
            aria-label="Schließen"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-9 w-9 animate-spin rounded-full border-b-2 border-white" />
          </div>
        ) : error || sorts.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <p className="text-lg font-bold">Mini Box gerade nicht verfügbar</p>
            <button
              type="button"
              onClick={() => setFetchAttempt((n) => n + 1)}
              className="rounded-full bg-white/10 px-5 py-2 font-bold transition hover:bg-white/20"
            >
              Nochmal versuchen
            </button>
            <Link href="/menu" className="font-bold text-primary-400 hover:underline">
              Zum Menü →
            </Link>
          </div>
        ) : (
          <>
            {/* Sorten-Karussell */}
            <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center">
              <button
                type="button"
                aria-label="Vorherige Sorte"
                onClick={() => paginate(-1)}
                className="absolute left-0 top-1/3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                aria-label="Nächste Sorte"
                onClick={() => paginate(1)}
                className="absolute right-0 top-1/3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20"
              >
                <ChevronRight className="h-6 w-6" />
              </button>

              <div className="relative flex w-full flex-1 items-center justify-center overflow-hidden">
                <AnimatePresence initial={false} custom={direction} mode="popLayout">
                  <motion.div
                    key={activeIndex}
                    custom={direction}
                    variants={slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    drag={reduceMotion ? false : 'x'}
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.7}
                    onDragEnd={(_, info) => {
                      if (info.offset.x < -60 || info.velocity.x < -400) paginate(1);
                      else if (info.offset.x > 60 || info.velocity.x > 400) paginate(-1);
                    }}
                    className="flex cursor-grab flex-col items-center active:cursor-grabbing"
                  >
                    {activeSort && (
                      <>
                        <div ref={pizzaImgRef} className="h-[min(42vw,200px)] w-[min(42vw,200px)]">
                          <motion.div
                            className="h-full w-full"
                            animate={reduceMotion ? undefined : { rotate: 360 }}
                            transition={
                              reduceMotion
                                ? undefined
                                : { repeat: Infinity, duration: 45, ease: 'linear' }
                            }
                          >
                            <PizzaDisc sort={activeSort} className="h-full w-full" />
                          </motion.div>
                        </div>
                        <p className="mt-3 max-w-[280px] text-center text-xl font-extrabold leading-tight">
                          <NoTranslate>{activeSort.name}</NoTranslate>
                        </p>
                        <p className="mt-0.5 text-sm font-bold text-primary-400">
                          <NoTranslate>{money(activeSort.price)}</NoTranslate>
                        </p>
                        <p className="mt-1 line-clamp-2 max-w-[300px] text-center text-xs leading-snug text-white/60">
                          {activeSort.description}
                        </p>
                      </>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Alle Sorten als Story-Avatare: Überblick + Direktsprung */}
              <div
                ref={thumbRailRef}
                className="scrollbar-hide -mx-4 mt-1 flex w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 pb-1"
                aria-label={`${sorts.length} Sorten verfügbar`}
              >
                {sorts.map((s, i) => {
                  const isActive = i === activeSortIndex;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      data-sort-index={i}
                      onClick={() => jumpToSort(i)}
                      aria-label={`Sorte wählen: ${s.name}`}
                      aria-current={isActive}
                      className="flex w-14 shrink-0 flex-col items-center gap-1"
                    >
                      <div
                        className={`h-12 w-12 rounded-full p-[3px] transition ${
                          isActive
                            ? 'bg-gradient-to-tr from-amber-400 via-primary-500 to-rose-500'
                            : 'bg-white/15'
                        }`}
                      >
                        <PizzaDisc sort={s} className="h-full w-full !shadow-none !ring-0" />
                      </div>
                      <span
                        className={`w-full truncate text-center text-[9px] font-semibold leading-tight ${
                          isActive ? 'text-white' : 'text-white/50'
                        }`}
                      >
                        <NoTranslate>{s.name}</NoTranslate>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* In die Box */}
              <button
                type="button"
                onClick={handleAddToBox}
                disabled={complete || !!flying}
                className="mt-2 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-primary-600 px-6 py-2.5 text-base font-bold shadow-lg transition-all hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-5 w-5 shrink-0" />
                In die Box
              </button>
            </div>

            {/* Die Schachtel */}
            <div className="mt-3 flex justify-center" style={{ perspective: 900 }}>
              <motion.div animate={boxControls} className="relative w-[228px]">
                <div className="rounded-2xl border border-amber-900/40 bg-gradient-to-b from-amber-200 to-amber-300 p-2 shadow-[inset_0_2px_10px_rgba(120,53,15,.35),0_10px_30px_rgba(0,0,0,.45)]">
                  <div className="grid grid-cols-2 gap-2">
                    {Array.from({ length: MINI_BOX_SLOTS }).map((_, i) => {
                      const slot = slots[i];
                      return (
                        <button
                          key={i}
                          type="button"
                          ref={(el) => {
                            slotRefs.current[i] = el;
                          }}
                          onClick={() => slot && removeSlot(slot.key)}
                          disabled={!slot || lidClosed}
                          aria-label={slot ? `${slot.sort.name} entfernen` : `Slot ${i + 1} frei`}
                          className="relative flex aspect-square items-center justify-center rounded-full"
                        >
                          <AnimatePresence>
                            {slot ? (
                              <motion.div
                                key={slot.key}
                                initial={reduceMotion ? false : { scale: 0.4, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={reduceMotion ? undefined : { scale: 0.4, opacity: 0, y: -30 }}
                                transition={{ type: 'spring', stiffness: 480, damping: 18 }}
                                onAnimationComplete={() => bumpBox()}
                                className="group absolute inset-0"
                              >
                                <PizzaDisc sort={slot.sort} className="h-full w-full !shadow-md ring-1 !ring-amber-900/25" />
                                <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[10px] font-bold text-white opacity-80 transition group-hover:opacity-100">
                                  ×
                                </span>
                              </motion.div>
                            ) : (
                              <motion.div
                                key="empty"
                                initial={false}
                                className="absolute inset-0 flex items-center justify-center rounded-full border-2 border-dashed border-amber-800/35 text-sm font-bold text-amber-900/45"
                              >
                                {i + 1}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Deckel: klappt bei 4/4 zu */}
                <motion.div
                  initial={false}
                  animate={{ rotateX: lidClosed ? 0 : -104, opacity: lidClosed ? 1 : 0.85 }}
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 190, damping: 19 }
                  }
                  style={{ transformOrigin: 'top center', backfaceVisibility: 'hidden' }}
                  className={`absolute inset-0 flex flex-col items-center justify-center rounded-2xl border border-amber-900/40 bg-gradient-to-b from-amber-300 to-amber-400 shadow-xl ${
                    lidClosed ? '' : 'pointer-events-none'
                  }`}
                >
                  <p className="text-lg font-black tracking-wide text-amber-950">DUMBO PIZZA</p>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-amber-900/70">
                    4× Mini · ca. Ø 18 cm
                  </p>
                  {lidClosed && (
                    <motion.p
                      initial={reduceMotion ? false : { scale: 1.7, opacity: 0, rotate: -10 }}
                      animate={{ scale: 1, opacity: 1, rotate: -4 }}
                      transition={{ delay: reduceMotion ? 0 : 0.28, type: 'spring', stiffness: 320, damping: 16 }}
                      className="mt-1.5 rounded-lg border-2 border-red-700 px-2.5 py-0.5 text-xl font-black text-red-700"
                      data-testid="minibox-stamp"
                    >
                      <NoTranslate>{money(total)}</NoTranslate>
                    </motion.p>
                  )}
                  {lidClosed && !added && (
                    <button
                      type="button"
                      onClick={() => setLidReopened(true)}
                      className="mt-1 text-xs font-bold text-amber-900/80 underline"
                    >
                      Box ändern
                    </button>
                  )}
                </motion.div>
              </motion.div>
            </div>

            {/* Summe + CTA */}
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-white/70">
                  {complete ? 'Deine Box ist voll!' : `Noch ${MINI_BOX_SLOTS - slots.length} wählen`}
                </span>
                <span className="text-xl font-extrabold" data-testid="minibox-total">
                  <NoTranslate>{money(total)}</NoTranslate>
                </span>
              </div>
              {added ? (
                <div className="flex gap-2">
                  <div className="flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-xl bg-green-600 px-4 font-bold">
                    <Check className="h-5 w-5 shrink-0" />
                    Im Warenkorb
                  </div>
                  <Link
                    href="/cart"
                    className="flex min-h-[52px] items-center justify-center rounded-xl bg-white px-5 font-bold text-gray-900 transition hover:bg-gray-100"
                  >
                    Zum Warenkorb →
                  </Link>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleAddToCart}
                  disabled={!complete}
                  className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-base font-bold shadow-lg transition-all hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/50"
                >
                  <ShoppingCart className="h-5 w-5 shrink-0" />
                  {complete ? (
                    <>In den Warenkorb · <NoTranslate>{money(total)}</NoTranslate></>
                  ) : (
                    <>Wähle {MINI_BOX_SLOTS} Mini-Pizzen</>
                  )}
                </button>
              )}
              {added && (
                <button
                  type="button"
                  onClick={resetBox}
                  className="mt-2 w-full text-center text-sm font-bold text-primary-400 hover:underline"
                >
                  Noch eine Box zusammenstellen
                </button>
              )}
            </div>
          </>
        )}

        {/* Fliegende Mini-Pizza: vom Karussell in den Slot (Bogenflug) */}
        {flying && fly && (
          <motion.div
            className="pointer-events-none fixed z-[70]"
            style={{
              left: flying.from.left,
              top: flying.from.top,
              width: flying.from.width,
              height: flying.from.height,
              transformOrigin: 'top left',
            }}
            initial={{ x: 0, y: 0, scale: 1, rotate: 0 }}
            animate={{
              x: [0, fly.dx * 0.5, fly.dx],
              y: [0, Math.min(0, fly.dy) - 90, fly.dy],
              scale: [1, 0.78, fly.scale],
              rotate: [0, -14, 0],
            }}
            transition={{ duration: 0.6, times: [0, 0.45, 1], ease: ['easeOut', 'easeIn'] }}
            onAnimationComplete={() => {
              commitSlot(flying.sort);
              setFlying(null);
            }}
          >
            <PizzaDisc sort={flying.sort} className="h-full w-full" />
          </motion.div>
        )}
      </div>
    </div>
  );
}
