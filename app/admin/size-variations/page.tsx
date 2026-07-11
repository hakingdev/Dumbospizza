"use client";

import { useState, useEffect } from 'react';
import { Plus, Trash2, Save, Ruler, Loader2 } from 'lucide-react';
import StatusModal from '../../../components/admin/StatusModal';

interface Variation {
  _id: string;
  name: string;
  label: string;
  order: number;
  active: boolean;
}

export default function SizeVariationsPage() {
  const [variations, setVariations] = useState<Variation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [modal, setModal] = useState<{ open: boolean; title?: string; message: string }>({
    open: false,
    message: ''
  });

  const load = async () => {
    try {
      const res = await fetch('/api/size-variations');
      const data = await res.json();
      if (data.success) setVariations(data.variations || []);
    } catch (e) {
      console.error(e);
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
      const res = await fetch('/api/size-variations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), label: newLabel.trim() })
      });
      const data = await res.json();
      if (data.success) {
        setVariations((prev) => [...prev, data.variation]);
        setNewName('');
        setNewLabel('');
      } else {
        setModal({ open: true, title: 'Ошибка', message: data.error || 'Не удалось создать' });
      }
    } finally {
      setSaving(false);
    }
  };

  const updateField = (id: string, field: 'name' | 'label' | 'active', value: any) => {
    setVariations((prev) =>
      prev.map((v) => (v._id === id ? { ...v, [field]: value } : v))
    );
  };

  const save = async (v: Variation) => {
    try {
      const res = await fetch(`/api/size-variations/${v._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: v.name, label: v.label, active: v.active, order: v.order })
      });
      const data = await res.json();
      if (data.success) {
        setModal({ open: true, title: 'Готово', message: 'Размер сохранён' });
      } else {
        setModal({ open: true, title: 'Ошибка', message: data.error || 'Не удалось сохранить' });
      }
    } catch (e: any) {
      setModal({ open: true, title: 'Ошибка', message: e.message });
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Удалить размер из библиотеки и из всех связанных товаров?')) return;
    try {
      const res = await fetch(`/api/size-variations/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setVariations((prev) => prev.filter((v) => v._id !== id));
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center gap-2 mb-2">
        <Ruler className="h-6 w-6 text-primary-600" />
        <h1 className="text-2xl font-bold">Библиотека размеров</h1>
      </div>
      <p className="text-gray-500 mb-6">
        Размеры задаются здесь один раз, затем подтягиваются к товарам — у товара меняется только цена.
      </p>

      {/* Добавить новый */}
      <div className="bg-white rounded-xl border p-4 mb-6">
        <h2 className="font-semibold mb-3">Добавить размер</h2>
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
            placeholder="Габарит (напр. ca.20x20 ≈ Ø 26 cm Pizza)"
            className="col-span-6 px-3 py-2 border rounded-lg"
          />
          <button
            type="button"
            onClick={create}
            disabled={!newName.trim() || saving}
            className="col-span-2 px-3 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center justify-center"
          >
            <Plus className="h-4 w-4 mr-1" />
            Добавить
          </button>
        </div>
      </div>

      {/* Список */}
      <div className="bg-white rounded-xl border">
        {loading ? (
          <div className="p-8 text-center text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin mx-auto" />
          </div>
        ) : variations.length === 0 ? (
          <div className="p-8 text-center text-gray-400">Пока нет размеров — добавьте первый выше.</div>
        ) : (
          <div className="divide-y">
            {variations.map((v) => (
              <div key={v._id} className="grid grid-cols-12 gap-2 items-center p-3">
                <input
                  type="text"
                  value={v.name}
                  onChange={(e) => updateField(v._id, 'name', e.target.value)}
                  className="col-span-3 px-3 py-2 border rounded-lg"
                />
                <input
                  type="text"
                  value={v.label}
                  onChange={(e) => updateField(v._id, 'label', e.target.value)}
                  className="col-span-5 px-3 py-2 border rounded-lg"
                />
                <label className="col-span-2 flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={v.active}
                    onChange={(e) => updateField(v._id, 'active', e.target.checked)}
                  />
                  Активен
                </label>
                <button
                  type="button"
                  onClick={() => save(v)}
                  className="col-span-1 text-primary-600 hover:text-primary-700"
                  title="Сохранить"
                >
                  <Save className="h-5 w-5 mx-auto" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(v._id)}
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
