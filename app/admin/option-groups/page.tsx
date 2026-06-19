"use client";

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2, Save, Layers, Loader2 } from 'lucide-react';
import StatusModal from '../../../components/admin/StatusModal';

interface Option {
  _id: string;
  name: string;
  price: number;
}

interface Group {
  _id: string;
  name: string;
  optionIds: any[]; // populated options или ids
  required: boolean;
  minSelect: number;
  maxSelect: number;
  active: boolean;
  order: number;
}

const normalizeIds = (group: Group): string[] =>
  (group.optionIds || []).map((option: any) => (typeof option === 'string' ? option : option._id));

export default function OptionGroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [library, setLibrary] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; title?: string; message: string }>({
    open: false,
    message: ''
  });

  const load = useCallback(async () => {
    try {
      const [gr, op] = await Promise.all([
        fetch('/api/option-groups').then((r) => r.json()),
        fetch('/api/options').then((r) => r.json())
      ]);
      if (gr.success) {
        setGroups(
          (gr.groups || []).map((g: Group) => ({ ...g, optionIds: normalizeIds(g) }))
        );
      }
      if (op.success) setLibrary(op.options || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!newName.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/option-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() })
      });
      const data = await res.json();
      if (data.success) {
        setGroups((prev) => [...prev, { ...data.group, optionIds: normalizeIds(data.group) }]);
        setNewName('');
      } else {
        setModal({ open: true, title: 'Ошибка', message: data.error || 'Ошибка' });
      }
    } finally {
      setSaving(false);
    }
  };

  const updateGroup = (id: string, patch: Partial<Group>) => {
    setGroups((prev) => prev.map((g) => (g._id === id ? { ...g, ...patch } : g)));
  };

  const toggleOption = (group: Group, optionId: string) => {
    const ids = group.optionIds as string[];
    const next = ids.includes(optionId) ? ids.filter((x) => x !== optionId) : [...ids, optionId];
    updateGroup(group._id, { optionIds: next });
  };

  const save = async (g: Group) => {
    const res = await fetch(`/api/option-groups/${g._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: g.name,
        optionIds: g.optionIds,
        required: g.required,
        minSelect: Number(g.minSelect) || 0,
        maxSelect: Number(g.maxSelect) || 0,
        active: g.active
      })
    });
    const data = await res.json();
    setModal({
      open: true,
      title: data.success ? 'Готово' : 'Ошибка',
      message: data.success ? 'Группа сохранена' : data.error || 'Ошибка'
    });
  };

  const remove = async (id: string) => {
    if (!confirm('Удалить группу опций? У товаров она отвяжется.')) return;
    const res = await fetch(`/api/option-groups/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) setGroups((prev) => prev.filter((g) => g._id !== id));
  };

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center gap-2 mb-2">
        <Layers className="h-6 w-6 text-primary-600" />
        <h1 className="text-2xl font-bold">Группы опций</h1>
      </div>
      <p className="text-gray-500 mb-6">
        Группы (Saucen, Beläge, Getränke…) собираются из{' '}
        <Link href="/admin/options" className="text-primary-600 underline">опций</Link> и
        привязываются к товарам — задайте правила выбора.
      </p>

      <div className="bg-white rounded-xl border p-4 mb-6">
        <h2 className="font-semibold mb-3">Создать группу</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Название группы (напр. Saucen)"
            className="flex-1 px-3 py-2 border rounded-lg"
          />
          <button
            type="button"
            onClick={create}
            disabled={!newName.trim() || saving}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center"
          >
            <Plus className="h-4 w-4 mr-1" />
            Создать
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin mx-auto" />
        </div>
      ) : groups.length === 0 ? (
        <div className="p-8 text-center text-gray-400 bg-white rounded-xl border">
          Пока нет групп — создайте первую выше.
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g._id} className="bg-white rounded-xl border p-4">
              <div className="flex items-center gap-2 mb-3">
                <input
                  type="text"
                  value={g.name}
                  onChange={(e) => updateGroup(g._id, { name: e.target.value })}
                  className="flex-1 px-3 py-2 border rounded-lg font-semibold"
                />
                <button onClick={() => save(g)} className="text-primary-600 hover:text-primary-700 p-2" title="Сохранить">
                  <Save className="h-5 w-5" />
                </button>
                <button onClick={() => remove(g._id)} className="text-red-600 hover:text-red-700 p-2" title="Удалить">
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>

              {/* Правила */}
              <div className="flex flex-wrap items-center gap-4 mb-3 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={g.required}
                    onChange={(e) => updateGroup(g._id, { required: e.target.checked })}
                  />
                  Обязательная (Erforderlich)
                </label>
                <label className="flex items-center gap-2">
                  Мин. выбрать:
                  <input
                    type="number"
                    min="0"
                    value={g.minSelect}
                    onChange={(e) => updateGroup(g._id, { minSelect: parseInt(e.target.value) || 0 })}
                    className="w-16 px-2 py-1 border rounded"
                  />
                </label>
                <label className="flex items-center gap-2">
                  Макс. выбрать:
                  <input
                    type="number"
                    min="0"
                    value={g.maxSelect}
                    onChange={(e) => updateGroup(g._id, { maxSelect: parseInt(e.target.value) || 0 })}
                    className="w-16 px-2 py-1 border rounded"
                  />
                  <span className="text-gray-400">(0 = без лимита)</span>
                </label>
                <label className="flex items-center gap-2 ml-auto">
                  <input
                    type="checkbox"
                    checked={g.active}
                    onChange={(e) => updateGroup(g._id, { active: e.target.checked })}
                  />
                  Активна
                </label>
              </div>

              {/* Опции в группе */}
              <div className="border-t pt-3">
                <p className="text-xs text-gray-500 mb-2">Опции в группе (из библиотеки):</p>
                {library.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    Нет опций. Создайте их на странице{' '}
                    <Link href="/admin/options" className="text-primary-600 underline">Опции</Link>.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {library.map((o) => {
                      const checked = (g.optionIds as string[]).includes(o._id);
                      return (
                        <label
                          key={o._id}
                          className={`flex items-center gap-2 text-sm p-2 rounded border cursor-pointer ${
                            checked ? 'border-primary-400 bg-primary-50' : 'border-gray-200'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleOption(g, o._id)}
                          />
                          <span className="flex-1">{o.name}</span>
                          <span className="text-gray-500">{o.price > 0 ? `+${o.price.toFixed(2)}€` : '—'}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <StatusModal
        open={modal.open}
        title={modal.title}
        message={modal.message}
        onClose={() => setModal({ open: false, message: '' })}
      />
    </div>
  );
}
