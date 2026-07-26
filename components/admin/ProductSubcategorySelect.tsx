"use client";

import Link from 'next/link';
import { matchCategory, readSubcategories } from '../../lib/categories/subcategories';

interface Props {
  /** загруженный список категорий (/api/categories?source=local) */
  categories: any[];
  /** текущая категория товара: id, слаг или populate-объект */
  category: unknown;
  value: string | null | undefined;
  onChange: (subcategoryId: string | null) => void;
}

/**
 * Выбор подкатегории товара. Список берётся из выбранной категории —
 * если у категории подкатегорий нет, поле подсказывает, где их завести.
 */
export default function ProductSubcategorySelect({ categories, category, value, onChange }: Props) {
  const selected = matchCategory(categories, category);
  const subcategories = readSubcategories(selected);

  return (
    <div>
      <label className="block text-sm font-medium mb-2">Подкатегория</label>

      {subcategories.length === 0 ? (
        <div className="rounded-lg border bg-gray-50 px-4 py-2 text-sm text-gray-500">
          У категории нет подкатегорий —{' '}
          <Link href="/admin/categories" className="text-primary-600 hover:underline">
            добавить
          </Link>
        </div>
      ) : (
        <select
          value={value || ''}
          onChange={(e) => onChange(e.target.value || null)}
          className="w-full px-4 py-2 border rounded-lg"
        >
          <option value="">Без подкатегории</option>
          {subcategories.map((sub) => (
            <option key={sub.id} value={sub.id}>
              {sub.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
