"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Trash2, Settings, Plus } from 'lucide-react';

interface Group {
  _id: string;
  name: string;
  optionIds: any[];
  required: boolean;
  minSelect: number;
  maxSelect: number;
}

interface Props {
  /** массив id или populated-объектов групп, привязанных к товару */
  value: any[];
  onChange: (ids: string[]) => void;
}

/**
 * Привязка переиспользуемых групп опций (Optionsgruppen) к товару.
 * Сами опции/группы не редактируются здесь — только подтягиваются готовыми.
 */
export default function ProductOptionGroupsEditor({ value, onChange }: Props) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedToAdd, setSelectedToAdd] = useState('');

  useEffect(() => {
    fetch('/api/option-groups?active=true')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setGroups(d.groups || []);
      })
      .catch(() => {});
  }, []);

  const selectedIds: string[] = (value || []).map((g: any) => (typeof g === 'string' ? g : g._id));

  const attached = selectedIds
    .map((id) => groups.find((g) => g._id === id))
    .filter(Boolean) as Group[];

  const available = groups.filter((g) => !selectedIds.includes(g._id));

  const add = (id: string) => {
    if (!id || selectedIds.includes(id)) return;
    onChange([...selectedIds, id]);
    setSelectedToAdd('');
  };

  const remove = (id: string) => {
    onChange(selectedIds.filter((x) => x !== id));
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <label className="block text-sm font-medium">Группы опций</label>
          <p className="text-xs text-gray-500">
            Подтяните готовые группы (топпинги, соусы, напитки…). Опции и цены задаются в библиотеке.
          </p>
        </div>
        <Link
          href="/admin/option-groups"
          target="_blank"
          className="text-gray-500 hover:text-gray-700 flex items-center text-sm"
        >
          <Settings className="h-4 w-4 mr-1" />
          Управление группами
        </Link>
      </div>

      <div className="space-y-2 mb-3">
        {attached.length === 0 && (
          <p className="text-sm text-gray-400 italic">Группы опций не привязаны.</p>
        )}
        {attached.map((g) => (
          <div key={g._id} className="flex items-center gap-2 px-4 py-2 border rounded-lg bg-gray-50">
            <div className="flex-1">
              <span className="font-medium">{g.name}</span>
              <span className="ml-2 text-xs text-gray-500">
                {g.required ? 'Обязательная' : 'Опциональная'}
                {' · '}
                {(g.optionIds || []).length} опц.
                {g.maxSelect ? ` · макс. ${g.maxSelect}` : ''}
              </span>
              <div className="text-xs text-gray-500 mt-0.5">
                {(g.optionIds || [])
                  .map((o: any) => (typeof o === 'string' ? '' : o.name))
                  .filter(Boolean)
                  .join(', ')}
              </div>
            </div>
            <button
              type="button"
              onClick={() => remove(g._id)}
              className="text-red-600 hover:text-red-700"
              title="Отвязать"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <select
          value={selectedToAdd}
          onChange={(e) => add(e.target.value)}
          className="flex-1 px-4 py-2 border rounded-lg bg-white"
        >
          <option value="">
            {available.length > 0 ? '+ Привязать группу опций…' : 'Все группы уже привязаны'}
          </option>
          {available.map((g) => (
            <option key={g._id} value={g._id}>
              {g.name} ({(g.optionIds || []).length} опц.)
            </option>
          ))}
        </select>
        <Link
          href="/admin/option-groups"
          target="_blank"
          className="text-primary-600 hover:text-primary-700 flex items-center text-sm whitespace-nowrap px-2"
        >
          <Plus className="h-4 w-4 mr-1" />
          Новая группа
        </Link>
      </div>
    </div>
  );
}
