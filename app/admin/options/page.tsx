"use client";

import { useState, useEffect } from 'react';
import { Plus, Trash2, Save, ListPlus, Loader2 } from 'lucide-react';
import StatusModal from '../../../components/admin/StatusModal';

interface Option {
  _id: string;
  name: string;
  price: number;
  active: boolean;
}

export default function OptionsPage() {
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [modal, setModal] = useState<{ open: boolean; title?: string; message: string }>({
    open: false,
    message: ''
  });

  const load = async () => {
    try {
      const res = await fetch('/api/options');
      const data = await res.json();
      if (data.success) setOptions(data.options || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!newName.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), price: parseFloat(newPrice) || 0 })
      });
      const data = await res.json();
      if (data.success) {
        setOptions((prev) => [...prev, data.option].sort((a, b) => a.name.localeCompare(b.name)));
        setNewName('');
        setNewPrice('');
      } else {
        setModal({ open: true, title: 'Ошибка', message: data.error || 'Не удалось создать' });
      }
    } finally {
      setSaving(false);
    }
  };

  const updateField = (id: string, field: 'name' | 'price' | 'active', value: any) => {
    setOptions((prev) => prev.map((o) => (o._id === id ? { ...o, [field]: value } : o)));
  };

  const save = async (o: Option) => {
    const res = await fetch(`/api/options/${o._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: o.name, price: Number(o.price) || 0, active: o.active })
    });
    const data = await res.json();
    setModal({
      open: true,
      title: data.success ? 'Готово' : 'Ошибка',
      message: data.success ? 'Опция сохранена' : data.error || 'Ошибка'
    });
  };

  const remove = async (id: string) => {
    if (!confirm('Удалить опцию из библиотеки?')) return;
    const res = await fetch(`/api/options/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) setOptions((prev) => prev.filter((o) => o._id !== id));
  };

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center gap-2 mb-2">
        <ListPlus className="h-6 w-6 text-primary-600" />
        <h1 className="text-2xl font-bold">Опции</h1>
      </div>
      <p className="text-gray-500 mb-6">
        Библиотека опций (топпинги, соусы, напитки…). Заводятся один раз и добавляются в группы опций.
      </p>

      <div className="bg-white rounded-xl border p-4 mb-6">
        <h2 className="font-semibold mb-3">Добавить опцию</h2>
        <div className="grid grid-cols-12 gap-2 items-center">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Название (напр. Bacon)"
            className="col-span-6 px-3 py-2 border rounded-lg"
          />
          <div className="col-span-4 relative">
            <input
              type="number"
              step="0.01"
              min="0"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              placeholder="Доп. цена"
              className="w-full px-3 py-2 border rounded-lg pr-7"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">€</span>
          </div>
          <button
            type="button"
            onClick={create}
            disabled={!newName.trim() || saving}
            className="col-span-2 px-3 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center justify-center"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">Бесплатная опция — поставьте цену 0.</p>
      </div>

      <div className="bg-white rounded-xl border">
        {loading ? (
          <div className="p-8 text-center text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin mx-auto" />
          </div>
        ) : options.length === 0 ? (
          <div className="p-8 text-center text-gray-400">Пока нет опций — добавьте первую выше.</div>
        ) : (
          <div className="divide-y">
            {options.map((o) => (
              <div key={o._id} className="grid grid-cols-12 gap-2 items-center p-3">
                <input
                  type="text"
                  value={o.name}
                  onChange={(e) => updateField(o._id, 'name', e.target.value)}
                  className="col-span-5 px-3 py-2 border rounded-lg"
                />
                <div className="col-span-3 relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={o.price}
                    onChange={(e) => updateField(o._id, 'price', parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 border rounded-lg pr-7"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">€</span>
                </div>
                <label className="col-span-2 flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={o.active}
                    onChange={(e) => updateField(o._id, 'active', e.target.checked)}
                  />
                  Активна
                </label>
                <button
                  type="button"
                  onClick={() => save(o)}
                  className="col-span-1 text-primary-600 hover:text-primary-700"
                  title="Сохранить"
                >
                  <Save className="h-5 w-5 mx-auto" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(o._id)}
                  className="col-span-1 text-red-600 hover:text-red-700"
                  title="Удалить"
                >
                  <Trash2 className="h-5 w-5 mx-auto" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <StatusModal
        open={modal.open}
        title={modal.title}
        message={modal.message}
        onClose={() => setModal({ open: false, message: '' })}
      />
    </div>
  );
}
