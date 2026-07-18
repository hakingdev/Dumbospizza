"use client";

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ShoppingCart, Check, ChevronDown, Pizza, CupSoda } from 'lucide-react';
import { useCart } from '../lib/contexts/CartContext';
import { normalizedSizeName } from '../lib/size-variation-state';
import { NoTranslate } from './NoTranslate';

/**
 * Matchday-Kombi (WM 2026): 2 Pizzen 30×40 nach Wahl + Getränke gratis.
 *
 * Preislogik (fix, nur innerhalb dieser Kombi):
 *   Kombi-Preis = Preis Pizza 1 (30×40) + Preis Pizza 2 (30×40) − 5 €
 * Getränke sind gratis und erhöhen den Preis NICHT.
 *
 * Preise kommen ausschließlich aus den echten Menüdaten (/api/products),
 * Größe „30×40“ entspricht in den Daten der Variante „ca. 30x40“.
 * Es werden keine Produktpreise verändert — der −5 €-Rabatt gilt nur in dieser Kombi.
 *
 * Der Abgleich läuft bewusst über normalizedSizeName und nicht über ===:
 * die Größe hieß früher „ca. 40x30“, und ein roher Vergleich hat die Kombi nach
 * der Umbenennung stillschweigend auf „nicht verfügbar“ gesetzt.
 */

const COMBO_DISCOUNT = 5; // fester Kombi-Rabatt in €
const FREE_DRINK_SLOTS = 2; // Anzahl Gratis-Getränke (nach Wahl)
const PIZZA_SIZE_NAME = 'ca. 30x40'; // Datenname für das 30×40-Format
const PIZZA_SIZE_KEY = normalizedSizeName(PIZZA_SIZE_NAME);

/** Die 30×40-Variante eines Produkts — unabhängig von der Schreibweise des Namens. */
const findComboSize = (product: any) =>
  (product?.sizes || []).find(
    (s: any) => normalizedSizeName(s?.name) === PIZZA_SIZE_KEY && s?.active !== false
  );

const money = (n: number) =>
  n.toFixed(2).replace('.', ',').replace(/,00$/, '') + ' €';

interface PizzaOption {
  id: string;
  name: string;
  price: number; // Preis der 30×40-Variante
}

interface DrinkOption {
  id: string;
  name: string;
}

interface PickerOption {
  value: string;
  label: string;
}

function ComboPicker({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-lg border border-gray-300 bg-white px-4 py-3 text-left text-base font-bold leading-snug text-gray-900 shadow-sm transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
        onClick={() => setOpen((current) => !current)}
      >
        <NoTranslate className="min-w-0 truncate">{selected?.label}</NoTranslate>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-gray-900 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[320px] overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-white p-1.5 shadow-2xl ring-1 ring-black/5"
        >
          {options.map((option) => {
            const selectedOption = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selectedOption}
                className={`flex min-h-[48px] w-full items-center justify-between gap-3 rounded-lg px-3.5 py-3 text-left text-base font-semibold leading-snug ${
                  selectedOption
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-900 hover:bg-primary-50'
                }`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <NoTranslate className="min-w-0">{option.label}</NoTranslate>
                {selectedOption && <Check className="h-4 w-4 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function MatchdayComboBuilder({ isDe }: { isDe: boolean }) {
  const { addItem } = useCart();

  const [pizzas, setPizzas] = useState<PizzaOption[]>([]);
  const [drinks, setDrinks] = useState<DrinkOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [pizza1, setPizza1] = useState('');
  const [pizza2, setPizza2] = useState('');
  const [drinkSlots, setDrinkSlots] = useState<string[]>(
    Array(FREE_DRINK_SLOTS).fill('')
  );
  const [added, setAdded] = useState(false);

  // Echte Menüdaten laden: Pizzen mit 30×40-Variante + Getränke.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/products?available=true&limit=500');
        const data = await res.json();
        if (!active) return;
        if (!data.success) {
          setError(true);
          return;
        }
        const list: any[] = data.products || [];

        const pizzaOpts: PizzaOption[] = list
          .filter((p) => p.category?.slug === 'pizza' && findComboSize(p))
          .map((p) => {
            const size = findComboSize(p);
            return {
              id: p._id || p.id,
              name: p.name,
              price: Number(size?.price) || 0,
            } as PizzaOption;
          })
          .sort((a, b) => a.name.localeCompare(b.name));

        const drinkOpts: DrinkOption[] = list
          .filter((p) => p.category?.slug === 'getränke')
          .map((p) => ({ id: p._id || p.id, name: p.name }))
          .sort((a, b) => a.name.localeCompare(b.name));

        setPizzas(pizzaOpts);
        setDrinks(drinkOpts);
        // Sinnvolle Vorauswahl, damit der Preis sofort sichtbar ist.
        if (pizzaOpts[0]) setPizza1(pizzaOpts[0].id);
        if (pizzaOpts[1]) setPizza2(pizzaOpts[1].id);
        if (drinkOpts[0]) {
          setDrinkSlots((slots) => {
            const next = [...slots];
            next[0] = drinkOpts[0].id;
            return next;
          });
        }
      } catch (e) {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const p1 = useMemo(() => pizzas.find((p) => p.id === pizza1), [pizzas, pizza1]);
  const p2 = useMemo(() => pizzas.find((p) => p.id === pizza2), [pizzas, pizza2]);

  const selectedDrinks = useMemo(
    () =>
      drinkSlots
        .filter(Boolean)
        .map((id) => drinks.find((d) => d.id === id))
        .filter((d): d is DrinkOption => Boolean(d)),
    [drinkSlots, drinks]
  );

  const regularPrice = (p1?.price || 0) + (p2?.price || 0);
  const comboPrice = Math.max(0, regularPrice - COMBO_DISCOUNT);
  const canAdd = Boolean(p1 && p2);

  const setDrinkAt = (index: number, value: string) =>
    setDrinkSlots((slots) => {
      const next = [...slots];
      next[index] = value;
      return next;
    });

  const handleAdd = () => {
    if (!p1 || !p2) return;

    // Eindeutige comboId gruppiert die EINZELNEN Positionen zu einer Kombi.
    const comboId = `combo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const comboLabel = isDe
      ? 'Matchday-Kombi · 2 Pizzen 30×40'
      : 'Matchday-Kombi · 2 Pizzen 30×40';
    const size = { id: 'combo-3040', name: '30×40', label: PIZZA_SIZE_NAME };

    const pizzaItem = (p: PizzaOption, index: number) => ({
      id: `${comboId}:pizza-${index}`,
      productId: p.id,
      name: p.name,
      price: p.price,
      basePrice: p.price,
      quantity: 1,
      size,
      comboId,
      comboLabel,
      comboRole: 'pizza' as const,
    });

    // Jede Komponente ist eine eigene Warenkorb-Position; Summe = Kombi-Preis.
    addItem(pizzaItem(p1, 1));
    addItem(pizzaItem(p2, 2));
    selectedDrinks.forEach((d, i) =>
      addItem({
        id: `${comboId}:drink-${i}`,
        productId: d.id,
        name: d.name,
        price: 0,
        basePrice: 0,
        quantity: 1,
        comboId,
        comboLabel,
        comboRole: 'drink' as const,
      })
    );
    addItem({
      id: `${comboId}:discount`,
      name: isDe
        ? `Kombi-Rabatt (statt ${money(regularPrice)})`
        : `Kombi-Rabatt (statt ${money(regularPrice)})`,
      price: -COMBO_DISCOUNT,
      basePrice: -COMBO_DISCOUNT,
      quantity: 1,
      comboId,
      comboLabel,
      comboRole: 'discount' as const,
    });

    setAdded(true);
    window.setTimeout(() => setAdded(false), 2500);
  };

  const pizzaOptions = useMemo(
    () =>
      pizzas.map((p) => ({
        value: p.id,
        label: `${p.name} — ${money(p.price)}`,
      })),
    [pizzas]
  );

  const drinkOptions = useMemo(
    () => [
      {
        value: '',
        label: isDe ? '— kein Getränk —' : '— kein Getränk —',
      },
      ...drinks.map((d) => ({
        value: d.id,
        label: d.name,
      })),
    ],
    [drinks, isDe]
  );

  return (
    <div className="mb-7 w-full max-w-[480px] rounded-2xl border border-white/25 bg-white/95 p-4 text-gray-800 shadow-xl backdrop-blur-[6px] sm:p-6">
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
        </div>
      ) : error || pizzas.length < 2 ? (
        <div className="py-6 text-center">
          <p className="font-semibold text-gray-900">
            {isDe ? 'Kombi gerade nicht verfügbar' : 'Kombi gerade nicht verfügbar'}
          </p>
          <Link href="/menu" className="mt-2 inline-block font-bold text-primary-600">
            {isDe ? 'Zum Menü' : 'Zum Menü'} →
          </Link>
        </div>
      ) : (
        <>
          {/* Pizza 1 */}
          <label className="mb-1.5 flex items-center gap-2 text-sm font-bold text-gray-900">
            <Pizza className="h-4 w-4 text-secondary-600" />
            {isDe ? '1. Pizza (30×40)' : '1. Pizza (30×40)'}
          </label>
          <ComboPicker
            ariaLabel={isDe ? '1. Pizza wählen' : '1. Pizza wählen'}
            value={pizza1}
            options={pizzaOptions}
            onChange={setPizza1}
          />

          {/* Pizza 2 */}
          <label className="mb-1.5 mt-4 flex items-center gap-2 text-sm font-bold text-gray-900">
            <Pizza className="h-4 w-4 text-secondary-600" />
            {isDe ? '2. Pizza (30×40)' : '2. Pizza (30×40)'}
          </label>
          <ComboPicker
            ariaLabel={isDe ? '2. Pizza wählen' : '2. Pizza wählen'}
            value={pizza2}
            options={pizzaOptions}
            onChange={setPizza2}
          />

          {/* Getränke gratis */}
          <label className="mb-1.5 mt-4 flex items-center gap-2 text-sm font-bold text-gray-900">
            <CupSoda className="h-4 w-4 text-secondary-600" />
            {isDe ? 'Getränke gratis' : 'Getränke gratis'}
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-700">
              <NoTranslate>GRATIS · 0,00 €</NoTranslate>
            </span>
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {drinkSlots.map((value, i) => (
              <ComboPicker
                key={i}
                ariaLabel={`${isDe ? 'Gratis-Getränk' : 'Gratis-Getränk'} ${i + 1}`}
                value={value}
                options={drinkOptions}
                onChange={(nextValue) => setDrinkAt(i, nextValue)}
              />
            ))}
          </div>

          {/* Preisaufstellung */}
          <div className="mt-5 space-y-1.5 border-t border-dashed border-gray-200 pt-4 text-sm">
            <div className="flex items-center justify-between text-gray-600">
              <span>{isDe ? 'Zwei Pizzen regulär' : 'Zwei Pizzen regulär'}</span>
              <NoTranslate className="font-semibold">{money(regularPrice)}</NoTranslate>
            </div>
            <div className="flex items-center justify-between text-gray-600">
              <span>{isDe ? 'Getränke' : 'Getränke'}</span>
              <span className="font-semibold text-green-600">
                {isDe ? 'gratis' : 'gratis'}
              </span>
            </div>
            <div className="flex items-center justify-between text-secondary-600">
              <span>{isDe ? 'Kombi-Rabatt' : 'Kombi-Rabatt'}</span>
              <NoTranslate className="font-semibold">−{money(COMBO_DISCOUNT)}</NoTranslate>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-gray-200 pt-2">
              <span className="text-base font-extrabold text-gray-900">
                {isDe ? 'Kombi-Preis' : 'Kombi-Preis'}
              </span>
              <span
                className="text-2xl font-extrabold tracking-[-.02em] text-gray-900"
                data-testid="combo-total"
              >
                <NoTranslate>{money(comboPrice)}</NoTranslate>
              </span>
            </div>
          </div>

          {/* CTA */}
          <button
            type="button"
            onClick={handleAdd}
            disabled={!canAdd}
            className={`mt-4 inline-flex min-h-[52px] w-full items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-xl px-3 py-3 text-sm font-bold leading-tight shadow-lg transition-all disabled:cursor-not-allowed disabled:opacity-60 sm:px-4 sm:text-base lg:px-6 ${
              added
                ? 'bg-green-600 text-white'
                : 'bg-primary-600 text-white hover:bg-primary-700'
            }`}
          >
            {added ? (
              <>
                <Check className="h-5 w-5 shrink-0" />
                <span className="truncate">{isDe ? 'Im Warenkorb' : 'Im Warenkorb'}</span>
              </>
            ) : (
              <>
                <ShoppingCart className="h-5 w-5 shrink-0" />
                <span className="min-w-0 truncate lg:hidden">
                  {isDe ? <>Kombi bestellen · <NoTranslate>{money(comboPrice)}</NoTranslate></> : <>Kombi bestellen · <NoTranslate>{money(comboPrice)}</NoTranslate></>}
                </span>
                <span className="hidden min-w-0 truncate lg:inline">
                  {isDe ? <>Kombi in den Warenkorb · <NoTranslate>{money(comboPrice)}</NoTranslate></> : <>Kombi in den Warenkorb · <NoTranslate>{money(comboPrice)}</NoTranslate></>}
                </span>
              </>
            )}
          </button>
          {added && (
            <Link
              href="/cart"
              className="mt-2 block text-center text-sm font-bold text-primary-600 hover:underline"
            >
              {isDe ? 'Zum Warenkorb →' : 'В корзину →'}
            </Link>
          )}
        </>
      )}
    </div>
  );
}
