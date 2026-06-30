"use client";

import { Trash2 } from 'lucide-react';
import type { CartItem } from '../../lib/contexts/CartContext';
import { type ComboGroup, isComboDiscountLine } from '../../lib/cart/combo';
import { NoTranslate } from '../NoTranslate';

const euro = (n: number) => `${n.toFixed(2)} €`;

/**
 * Stellt eine Matchday-Kombi als zusammenhängende Karte dar — jede Komponente
 * (Pizzen, Gratis-Getränke, Rabatt) ist eine EIGENE Zeile mit eigenem Preis,
 * darunter der Kombi-Gesamtpreis. Die ganze Kombi wird gemeinsam entfernt.
 */
export function ComboCartGroup({
  group,
  onRemove,
  freeLabel = 'gratis',
}: {
  group: ComboGroup<CartItem>;
  onRemove: (comboId: string) => void;
  freeLabel?: string;
}) {
  return (
    <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-red-100 text-2xl">
            🍕
          </div>
          <h3 className="min-w-0 break-words font-bold leading-tight text-red-700">
            <NoTranslate>{group.label}</NoTranslate>
          </h3>
        </div>
        <button
          type="button"
          onClick={() => onRemove(group.comboId)}
          className="shrink-0 text-gray-400 transition-colors hover:text-red-600"
          aria-label="Kombi entfernen"
        >
          <Trash2 className="h-5 w-5" />
        </button>
      </div>

      <ul className="mt-3 space-y-1.5">
        {group.items.map((it) => {
          const discount = isComboDiscountLine(it);
          const isFree = it.comboRole === 'drink' && it.price === 0;
          const sizeLabel = it.size?.name || it.size?.label || it.size?.size;
          return (
            <li
              key={it.id}
              className={`flex items-start justify-between gap-3 text-sm ${
                discount ? 'font-bold text-red-600' : 'text-red-800'
              }`}
            >
              <span className="flex min-w-0 items-start gap-1.5">
                <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                <span className="min-w-0">
                  <NoTranslate>{it.name}</NoTranslate>
                  {it.comboRole === 'pizza' && sizeLabel ? (
                    <NoTranslate className="text-red-500"> ({sizeLabel})</NoTranslate>
                  ) : null}
                </span>
              </span>
              <NoTranslate className="shrink-0 whitespace-nowrap">
                {discount
                  ? `−${euro(Math.abs(it.price) * it.quantity)}`
                  : isFree
                    ? freeLabel
                    : euro(it.price * it.quantity)}
              </NoTranslate>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex items-center justify-between border-t border-red-200 pt-3">
        <span className="font-extrabold text-red-700">Gesamt</span>
        <NoTranslate className="text-lg font-extrabold text-red-600">{euro(group.total)}</NoTranslate>
      </div>
    </div>
  );
}
