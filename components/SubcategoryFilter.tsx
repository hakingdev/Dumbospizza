"use client";

import type { Subcategory } from '../lib/categories/subcategories';

interface Props {
  subcategories: Subcategory[];
  /** сколько товаров в каждой подкатегории; ключ '' — товары без метки */
  counts: Record<string, number>;
  /** null — показаны все */
  value: string | null;
  onChange: (subcategoryId: string | null) => void;
  allLabel: string;
  /** подпись для товаров без подкатегории (показывается, только если они есть) */
  restLabel: string;
}

/**
 * Переключатель подкатегорий внутри категории. Показывается только когда у
 * категории есть подкатегории; пустые подкатегории скрыты, чтобы гость не
 * попадал на «здесь ничего нет».
 */
export default function SubcategoryFilter({
  subcategories,
  counts,
  value,
  onChange,
  allLabel,
  restLabel,
}: Props) {
  const visible = subcategories.filter((s) => (counts[s.id] || 0) > 0);
  if (visible.length === 0) return null;

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const restCount = counts[''] || 0;

  const chips: { id: string | null; name: string; count: number }[] = [
    { id: null, name: allLabel, count: total },
    ...visible.map((s) => ({ id: s.id, name: s.name, count: counts[s.id] || 0 })),
  ];
  if (restCount > 0) chips.push({ id: '', name: restLabel, count: restCount });

  return (
    <div className="scrollbar-hide -mx-1 mb-6 flex gap-2 overflow-x-auto px-1 py-1" role="tablist">
      {chips.map((chip) => {
        const active = chip.id === value;
        return (
          <button
            key={chip.id ?? 'alle'}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(chip.id)}
            className={`shrink-0 whitespace-nowrap rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              active
                ? 'border-primary-600 bg-primary-600 text-white'
                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            {chip.name}
            <span className={`ml-1.5 ${active ? 'text-white/70' : 'text-gray-400'}`}>{chip.count}</span>
          </button>
        );
      })}
    </div>
  );
}
