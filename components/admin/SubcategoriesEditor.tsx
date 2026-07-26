"use client";

import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import type { Subcategory } from '../../lib/categories/subcategories';

interface Props {
  value: Subcategory[];
  onChange: (subcategories: Subcategory[]) => void;
}

/**
 * Редактор подкатегорий категории (Pizza → Rund; MakiLove Sushi → Philadelphia).
 * Порядок строк = порядок блоков в меню. id новым строкам проставляет сервер
 * (POST/PUT /api/categories), поэтому здесь он пустой — при переименовании
 * существующей строки id сохраняется и товары остаются привязанными.
 */
export default function SubcategoriesEditor({ value, onChange }: Props) {
  const rows = value || [];

  const add = () => onChange([...rows, { id: '', name: '', order: rows.length }]);

  const rename = (index: number, name: string) => {
    const next = [...rows];
    next[index] = { ...next[index], name };
    onChange(next);
  };

  const remove = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    onChange(next.map((row, i) => ({ ...row, order: i })));
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next.map((row, i) => ({ ...row, order: i })));
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="block text-sm font-medium">Подкатегории</label>
        <button
          type="button"
          onClick={add}
          className="flex items-center text-sm text-primary-600 hover:text-primary-700"
        >
          <Plus className="mr-1 h-4 w-4" />
          Добавить подкатегорию
        </button>
      </div>

      <p className="mb-3 text-xs text-gray-500">
        Группы товаров внутри категории — например «Rund» в Pizza или «Philadelphia» в
        MakiLove Sushi. В меню каждая подкатегория выводится отдельным блоком в этом порядке.
        Товары без подкатегории показываются первыми.
      </p>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-center text-sm text-gray-500">
          Подкатегорий нет — товары показываются одним списком.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={row.id || `new-${index}`} className="flex items-center gap-2">
              <span className="w-6 text-center text-sm text-gray-400">{index + 1}</span>
              <input
                type="text"
                value={row.name}
                onChange={(e) => rename(index, e.target.value)}
                placeholder="Название подкатегории"
                className="flex-1 rounded-lg border px-3 py-2"
              />
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                className="p-2 text-gray-500 hover:text-gray-800 disabled:opacity-30"
                title="Выше"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === rows.length - 1}
                className="p-2 text-gray-500 hover:text-gray-800 disabled:opacity-30"
                title="Ниже"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => remove(index)}
                className="p-2 text-gray-500 hover:text-red-600"
                title="Удалить"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          Удаление подкатегории не удаляет товары — они просто теряют метку.
        </p>
      )}
    </div>
  );
}
