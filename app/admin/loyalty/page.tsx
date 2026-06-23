'use client';

import { useEffect, useState } from 'react';
import { Star, Loader2, Save, Trophy } from 'lucide-react';

export default function AdminLoyaltyPage() {
  const [rules, setRules] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [top, setTop] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/admin/loyalty-rules')
      .then((r) => r.json())
      .then((d) => d.success && setRules(d.rules))
      .finally(() => setLoading(false));
    fetch('/api/admin/customers/top')
      .then((r) => r.json())
      .then((d) => d.success && setTop(d.customers));
  }, []);

  const setPct = (tier: string, val: number) =>
    setRules((r: any) => ({
      ...r,
      earnPercentByTier: { ...r.earnPercentByTier, [tier]: val / 100 },
    }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch('/api/admin/loyalty-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rules),
      });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'Fehler');
      setRules(d.rules);
      setSaved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading || !rules) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-6 flex items-center text-2xl font-bold">
        <Star className="mr-2 h-6 w-6 text-yellow-500" /> Бонусная программа
      </h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Rules editor */}
        <form onSubmit={save} className="space-y-4 rounded-lg bg-white p-6 shadow-sm">
          <h2 className="font-semibold">Правила начисления</h2>

          <div className="grid grid-cols-3 gap-3">
            {(['bronze', 'silver', 'gold'] as const).map((tier) => (
              <div key={tier}>
                <label className="mb-1 block text-xs font-medium capitalize text-gray-600">
                  {tier} %
                </label>
                <input
                  type="number"
                  step="0.5"
                  min={0}
                  max={100}
                  value={Math.round((rules.earnPercentByTier[tier] || 0) * 1000) / 10}
                  onChange={(e) => setPct(tier, Number(e.target.value))}
                  className="w-full rounded-md border px-2 py-1.5 text-sm"
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Порог Silver (заказов)"
              value={rules.tierThresholds.silver}
              onChange={(v) => setRules((r: any) => ({ ...r, tierThresholds: { ...r.tierThresholds, silver: v } }))}
            />
            <Field
              label="Порог Gold (заказов)"
              value={rules.tierThresholds.gold}
              onChange={(v) => setRules((r: any) => ({ ...r, tierThresholds: { ...r.tierThresholds, gold: v } }))}
            />
            <Field
              label="Макс. оплата баллами (%)"
              value={Math.round(rules.redeemMaxShare * 100)}
              onChange={(v) => setRules((r: any) => ({ ...r, redeemMaxShare: v / 100 }))}
            />
            <Field
              label="Мин. сумма для списания (€)"
              value={rules.minOrderToRedeem}
              onChange={(v) => setRules((r: any) => ({ ...r, minOrderToRedeem: v }))}
            />
            <Field
              label="1 балл = € скидки"
              step="0.01"
              value={rules.pointValueEuro}
              onChange={(v) => setRules((r: any) => ({ ...r, pointValueEuro: v }))}
            />
            <Field
              label="Срок действия (мес.)"
              value={rules.expiryMonths}
              onChange={(v) => setRules((r: any) => ({ ...r, expiryMonths: v }))}
            />
            <Field
              label="Множитель в выходные"
              step="0.1"
              value={rules.weekendMultiplier}
              onChange={(v) => setRules((r: any) => ({ ...r, weekendMultiplier: v }))}
            />
            <Field
              label="Бонус за первый заказ"
              value={rules.firstOrderBonus}
              onChange={(v) => setRules((r: any) => ({ ...r, firstOrderBonus: v }))}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {saved && <p className="text-sm text-green-600">Сохранено ✓</p>}

          <button
            type="submit"
            disabled={saving}
            className="flex items-center justify-center rounded-md bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Сохранить
          </button>
        </form>

        {/* Top customers */}
        <div className="rounded-lg bg-white p-6 shadow-sm">
          <h2 className="mb-4 flex items-center font-semibold">
            <Trophy className="mr-2 h-5 w-5 text-yellow-500" /> Самые активные клиенты
          </h2>
          {top.length === 0 ? (
            <p className="text-sm text-gray-500">Пока нет данных.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-gray-500">
                  <th className="py-2">Клиент</th>
                  <th className="py-2 text-right">Заказов</th>
                  <th className="py-2 text-right">Сумма</th>
                  <th className="py-2 text-right">Баллы</th>
                </tr>
              </thead>
              <tbody>
                {top.map((c) => (
                  <tr key={c.id} className="border-b">
                    <td className="py-2">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-gray-500">{c.phoneNumber}</div>
                    </td>
                    <td className="py-2 text-right">{c.ordersCount}</td>
                    <td className="py-2 text-right">{c.totalSpent.toFixed(2)} €</td>
                    <td className="py-2 text-right text-primary-600">{c.points.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  step = '1',
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-md border px-2 py-1.5 text-sm"
      />
    </div>
  );
}
