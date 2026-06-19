"use client";

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface PromoItem {
  productId: string;
  sizeName: string; // '' = весь товар (все размеры)
}

interface ProductLike {
  _id: string;
  name: string;
  category: any; // id или { _id, name }
  sizes?: { name: string; label?: string; size?: string }[];
}

interface CategoryLike {
  _id: string;
  name: string;
}

function catIdOf(p: ProductLike): string {
  return String(typeof p.category === 'string' ? p.category : p.category?._id || '');
}

/** Чекбокс с поддержкой indeterminate (частичный выбор). */
function TriCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = !checked && indeterminate;
      }}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/**
 * Вложенный селектор позиций (Lieferando-стиль): категория → товар → размеры/штуки.
 * Возвращает список { productId, sizeName }. sizeName='' = товар без размеров.
 * Есть быстрый выбор: «весь товар» (все размеры) и «вся категория».
 */
export default function PromoItemSelector({
  products,
  categories,
  value,
  onChange,
}: {
  products: ProductLike[];
  categories: CategoryLike[];
  value: PromoItem[];
  onChange: (v: PromoItem[]) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const sizesOf = (p: ProductLike) => (p.sizes || []).filter((s) => s?.name);

  const has = (productId: string, sizeName: string) =>
    value.some((v) => v.productId === productId && (v.sizeName || '') === sizeName);

  const toggle = (productId: string, sizeName: string) => {
    if (has(productId, sizeName)) {
      onChange(value.filter((v) => !(v.productId === productId && (v.sizeName || '') === sizeName)));
    } else {
      onChange([...value, { productId, sizeName }]);
    }
  };

  const productEntries = (p: ProductLike) => value.filter((v) => v.productId === p._id);
  const isProductAll = (p: ProductLike) => {
    const sizes = sizesOf(p);
    if (sizes.length === 0) return has(p._id, '');
    return sizes.every((s) => has(p._id, s.name));
  };
  const isProductSome = (p: ProductLike) => productEntries(p).length > 0;

  const setProductEntries = (base: PromoItem[], p: ProductLike, on: boolean): PromoItem[] => {
    const without = base.filter((v) => v.productId !== p._id);
    if (!on) return without;
    const sizes = sizesOf(p);
    if (sizes.length === 0) return [...without, { productId: p._id, sizeName: '' }];
    return [...without, ...sizes.map((s) => ({ productId: p._id, sizeName: s.name }))];
  };

  const toggleProductAll = (p: ProductLike) => {
    onChange(setProductEntries(value, p, !isProductAll(p)));
  };

  const isCatAll = (items: ProductLike[]) => items.length > 0 && items.every((p) => isProductAll(p));
  const isCatSome = (items: ProductLike[]) => items.some((p) => isProductSome(p));
  const toggleCatAll = (items: ProductLike[]) => {
    const on = !isCatAll(items);
    let next = [...value];
    for (const p of items) next = setProductEntries(next, p, on);
    onChange(next);
  };

  const groups = categories
    .map((c) => ({ c, items: products.filter((p) => catIdOf(p) === String(c._id)) }))
    .filter((g) => g.items.length > 0);

  const known = new Set(groups.flatMap((g) => g.items.map((p) => p._id)));
  const orphans = products.filter((p) => !known.has(p._id));
  if (orphans.length > 0) groups.push({ c: { _id: '__other', name: 'Прочее' }, items: orphans });

  return (
    <div className="border rounded-lg divide-y">
      {groups.map(({ c, items }) => {
        const isOpen = open[c._id];
        const selected = value.filter((v) => items.some((p) => p._id === v.productId)).length;
        return (
          <div key={c._id}>
            <div className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50">
              <span className="flex items-center gap-2 font-medium">
                <TriCheckbox
                  checked={isCatAll(items)}
                  indeterminate={isCatSome(items)}
                  onChange={() => toggleCatAll(items)}
                />
                <button
                  type="button"
                  onClick={() => setOpen((s) => ({ ...s, [c._id]: !s[c._id] }))}
                  className="flex items-center gap-2"
                >
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  {c.name}
                  <span className="text-xs text-gray-400">{items.length} Artikel</span>
                </button>
              </span>
              {selected > 0 && (
                <span className="text-xs bg-primary-100 text-primary-700 rounded-full px-2 py-0.5">
                  {selected} выбрано
                </span>
              )}
            </div>

            {isOpen && (
              <div className="px-4 pb-3 space-y-3 bg-gray-50/50">
                {items.map((p) => {
                  const sizes = sizesOf(p);
                  return (
                    <div key={p._id} className="pt-2">
                      <label className="flex items-center gap-2 font-medium text-sm text-gray-800 cursor-pointer">
                        <TriCheckbox
                          checked={isProductAll(p)}
                          indeterminate={isProductSome(p)}
                          onChange={() => toggleProductAll(p)}
                        />
                        {p.name}
                        {sizes.length > 0 && <span className="text-xs text-gray-400">(все размеры)</span>}
                      </label>
                      {sizes.length > 0 && (
                        <div className="mt-1 ml-6 grid grid-cols-1 sm:grid-cols-2 gap-1">
                          {sizes.map((s) => (
                            <label
                              key={s.name}
                              className="flex items-center gap-2 text-sm py-1 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={has(p._id, s.name)}
                                onChange={() => toggle(p._id, s.name)}
                              />
                              <span>{s.label || s.size || s.name}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {groups.length === 0 && (
        <div className="px-4 py-6 text-center text-gray-400 text-sm">Нет товаров</div>
      )}
    </div>
  );
}
