"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Trash2, Settings } from 'lucide-react';

export interface ProductSizeRow {
  id: string;
  variationId?: string;
  name: string;
  label: string;
  price: number;
  active?: boolean;
}

interface Variation {
  _id: string;
  name: string;
  label: string;
}

interface Props {
  sizes: ProductSizeRow[];
  onChange: (sizes: ProductSizeRow[]) => void;
}

/**
 * Редактор размеров товара (модель Lieferando):
 * размеры подтягиваются из общей библиотеки (Artikelvariationen),
 * у товара редактируется только цена каждого размера.
 */
export default function ProductSizesEditor({ sizes, onChange }: Props) {
  const [variations, setVariations] = useState<Variation[]>([]);
  const [selectedToAdd, setSelectedToAdd] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [creating, setCreating] = useState(false);

  const loadVariations = () => {
    fetch('/api/size-variations?active=true')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setVariations(d.variations || []);
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadVariations();
  }, []);

  const usedIds = new Set(sizes.map((s) => s.variationId).filter(Boolean) as string[]);
  const available = variations.filter((v) => !usedIds.has(v._id));

  const addFromLibrary = (variationId: string) => {
    const v = variations.find((x) => x._id === variationId);
    if (!v) return;
    onChange([
      ...sizes,
      { id: v._id, variationId: v._id, name: v.name, label: v.label, price: 0, active: true }
    ]);
    setSelectedToAdd('');
  };

  const updatePrice = (index: number, price: number) => {
    const next = [...sizes];
    next[index] = { ...next[index], price };
    onChange(next);
  };

  const removeRow = (index: number) => {
    const next = [...sizes];
    next.splice(index, 1);
    onChange(next);
  };

  const createVariation = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/size-variations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), label: newLabel.trim() })
      });
      const d = await res.json();
      if (d.success && d.variation) {
        setVariations((prev) => [...prev, d.variation]);
        onChange([
          ...sizes,
          {
            id: d.variation._id,
            variationId: d.variation._id,
            name: d.variation.name,
            label: d.variation.label,
            price: 0,
            active: true
          }
        ]);
        setNewName('');
        setNewLabel('');
        setShowCreate(false);
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <label className="block text-sm font-medium">Размеры</label>
          <p className="text-xs text-gray-500">
            Подтяните размеры из библиотеки и задайте цену для каждого. Цена за размер — итоговая.
          </p>
        </div>
        <Link
          href="/admin/size-variations"
          target="_blank"
          className="text-gray-500 hover:text-gray-700 flex items-center text-sm"
        >
          <Settings className="h-4 w-4 mr-1" />
          Библиотека размеров
        </Link>
      </div>

      {/* Выбранные размеры товара */}
      <div className="space-y-2 mb-3">
        {sizes.length === 0 && (
          <p className="text-sm text-gray-400 italic">
            Размеры не добавлены — товар продаётся по базовой цене.
          </p>
        )}
        {sizes.map((size, index) => (
          <div key={size.id || index} className="grid grid-cols-12 gap-2 items-center">
            <div className="col-span-7">
              <div className="px-4 py-2 border rounded-lg bg-gray-50">
                <span className="font-medium">{size.name}</span>
                {size.label && <span className="text-gray-500 text-sm ml-2">{size.label}</span>}
                {size.active === false && (
                  <span className="ml-2 text-xs font-medium text-red-600">Выключен в библиотеке</span>
                )}
              </div>
            </div>
            <div className="col-span-4">
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={size.price}
                  onChange={(e) => updatePrice(index, parseFloat(e.target.value) || 0)}
                  className="w-full px-4 py-2 border rounded-lg pr-8"
                  placeholder="Цена"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">€</span>
              </div>
            </div>
            <div className="col-span-1">
              <button
                type="button"
                onClick={() => removeRow(index)}
                className="w-full text-red-600 hover:text-red-700"
                title="Убрать размер"
              >
                <Trash2 className="h-5 w-5 mx-auto" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Добавление размера из библиотеки */}
      <div className="flex items-center gap-2">
        <select
          value={selectedToAdd}
          onChange={(e) => {
            if (e.target.value) addFromLibrary(e.target.value);
          }}
          className="flex-1 px-4 py-2 border rounded-lg bg-white"
        >
          <option value="">
            {available.length > 0 ? '+ Добавить размер из библиотеки…' : 'Все размеры уже добавлены'}
          </option>
          {available.map((v) => (
            <option key={v._id} value={v._id}>
              {v.name}
              {v.label ? ` — ${v.label}` : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowCreate((s) => !s)}
          className="text-primary-600 hover:text-primary-700 flex items-center text-sm whitespace-nowrap px-2"
        >
          <Plus className="h-4 w-4 mr-1" />
          Новый размер
        </button>
      </div>

      {/* Инлайн-создание нового размера в библиотеке */}
      {showCreate && (
        <div className="mt-3 p-3 border rounded-lg bg-gray-50">
          <div className="grid grid-cols-12 gap-2 items-center">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Название (напр. Solo)"
              className="col-span-4 px-3 py-2 border rounded-lg"
            />
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Габарит (напр. ca.20x20 ≈ Ø 26 cm)"
              className="col-span-6 px-3 py-2 border rounded-lg"
            />
            <button
              type="button"
              onClick={createVariation}
              disabled={!newName.trim() || creating}
              className="col-span-2 px-3 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 text-sm"
            >
              {creating ? '...' : 'Создать'}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Размер добавится в общую библиотеку и сразу подтянется к этому товару.
          </p>
        </div>
      )}
    </div>
  );
}
