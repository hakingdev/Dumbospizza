'use client';

import { useEffect, useState, useCallback } from 'react';
import { Search, Users, Star, X, Loader2 } from 'lucide-react';

const TIER_LABEL: Record<string, string> = { bronze: 'Bronze', silver: 'Silber', gold: 'Gold' };
const TX_LABEL: Record<string, string> = {
  earn: 'Gutschrift',
  redeem: 'Eingelöst',
  expire: 'Verfallen',
  adjust: 'Korrektur',
  reverse: 'Storno',
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<any>(null);

  const load = useCallback(async (search = '') => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/customers${search ? `?q=${encodeURIComponent(search)}` : ''}`);
      const data = await res.json();
      if (data.success) setCustomers(data.customers);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => load(q), 300);
    return () => clearTimeout(t);
  }, [q, load]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Клиенты</h1>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск (имя, email, телефон)..."
            className="w-72 rounded-lg border py-2 pl-10 pr-4"
          />
        </div>
      </div>

      <div className="rounded-lg bg-white shadow-sm">
        {loading ? (
          <div className="flex justify-center p-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : customers.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <Users className="mx-auto mb-3 h-12 w-12 opacity-20" />
            <p>Клиенты не найдены</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-sm text-gray-500">
                <th className="px-6 py-3">Имя</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">Телефон</th>
                <th className="px-6 py-3 text-right">Заказов</th>
                <th className="px-6 py-3 text-right">Баллы</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className="cursor-pointer border-b hover:bg-gray-50"
                >
                  <td className="px-6 py-4 font-medium">{c.name}</td>
                  <td className="px-6 py-4 text-gray-600">{c.email || '—'}</td>
                  <td className="px-6 py-4 text-gray-600">{c.phoneNumber}</td>
                  <td className="px-6 py-4 text-right">{c.ordersCount}</td>
                  <td className="px-6 py-4 text-right font-semibold text-primary-600">
                    {Number(c.points).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <CustomerDrawer
          customerId={selected.id}
          onClose={() => setSelected(null)}
          onChanged={() => load(q)}
        />
      )}
    </div>
  );
}

function CustomerDrawer({
  customerId,
  onClose,
  onChanged,
}: {
  customerId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/customers/${customerId}`);
    const d = await res.json();
    if (d.success) setData(d);
    setLoading(false);
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const value = Number(delta);
    if (!value) {
      setError('Введите число (≠0)');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta: value, description: reason }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'Fehler');
      setDelta('');
      setReason('');
      await load();
      onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-y-auto bg-white shadow-xl">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">Клиент</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading || !data ? (
          <div className="flex justify-center p-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="space-y-6 p-4">
            <div>
              <p className="text-lg font-medium">{data.customer.name}</p>
              <p className="text-sm text-gray-500">{data.customer.email || '—'}</p>
              <p className="text-sm text-gray-500">{data.customer.phoneNumber}</p>
            </div>

            <div className="rounded-lg bg-primary-50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500">Баланс баллов</p>
                  <p className="text-2xl font-bold text-primary-700">
                    {data.loyalty.balance.toFixed(2)}
                  </p>
                </div>
                <span className="flex items-center rounded-full bg-white px-3 py-1 text-xs font-semibold text-gray-700">
                  <Star className="mr-1 h-3 w-3 text-yellow-500" />
                  {TIER_LABEL[data.loyalty.tier]} · {data.loyalty.completedOrders} Bestellungen
                </span>
              </div>
            </div>

            {/* Manual adjust */}
            <form onSubmit={submit} className="space-y-3 rounded-lg border p-4">
              <p className="text-sm font-medium">Ручная корректировка</p>
              <input
                type="number"
                step="0.01"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
                placeholder="напр. 5 или -3"
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Причина (необязательно)"
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={saving}
                className="flex w-full items-center justify-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Применить
              </button>
              <p className="text-xs text-gray-400">
                Положительное число — начислить, отрицательное — списать.
              </p>
            </form>

            {/* History */}
            <div>
              <p className="mb-2 text-sm font-medium">История операций</p>
              {data.transactions.length === 0 ? (
                <p className="text-sm text-gray-500">Пока нет операций.</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {data.transactions.map((t: any) => (
                    <li key={t.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <div>
                        <p className="font-medium">{TX_LABEL[t.type] || t.type}</p>
                        <p className="text-xs text-gray-500">
                          {new Date(t.createdAt).toLocaleDateString('de-DE')} · {t.description}
                        </p>
                      </div>
                      <span
                        className={`font-semibold ${
                          Number(t.delta) >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {Number(t.delta) >= 0 ? '+' : ''}
                        {Number(t.delta).toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
