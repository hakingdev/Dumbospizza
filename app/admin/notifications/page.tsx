'use client';

import { useEffect, useState } from 'react';
import { Megaphone, Send, Loader2, CheckCircle2 } from 'lucide-react';

type AudienceType = 'all' | 'customer' | 'inactive' | 'product';

const AUDIENCE_LABEL: Record<string, string> = {
  all: 'Все клиенты',
  customer: 'Один клиент',
  inactive: 'Давно не заказывали',
  product: 'Частые покупатели товара',
};

export default function AdminNotificationsPage() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [category, setCategory] = useState('promo');

  const [audienceType, setAudienceType] = useState<AudienceType>('all');
  const [inactiveDays, setInactiveDays] = useState(60);
  const [productId, setProductId] = useState('');
  const [minCount, setMinCount] = useState(2);

  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);

  const [products, setProducts] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<number | null>(null);

  const loadCampaigns = () =>
    fetch('/api/admin/notifications')
      .then((r) => r.json())
      .then((d) => d.success && setCampaigns(d.campaigns));

  useEffect(() => {
    fetch('/api/products?limit=500')
      .then((r) => r.json())
      .then((d) => d.success && setProducts(d.products || []));
    loadCampaigns();
  }, []);

  // Поиск клиента (debounce)
  useEffect(() => {
    if (audienceType !== 'customer' || customerQuery.trim().length < 2) {
      setCustomerResults([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/admin/customers?q=${encodeURIComponent(customerQuery)}`)
        .then((r) => r.json())
        .then((d) => d.success && setCustomerResults(d.customers.slice(0, 8)));
    }, 300);
    return () => clearTimeout(t);
  }, [customerQuery, audienceType]);

  const buildAudience = () => {
    switch (audienceType) {
      case 'all':
        return { type: 'all' };
      case 'customer':
        return selectedCustomer ? { type: 'customer', userId: selectedCustomer.id } : null;
      case 'inactive':
        return { type: 'inactive', days: inactiveDays };
      case 'product':
        return productId ? { type: 'product', productId, minCount } : null;
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    const audience = buildAudience();
    if (!audience) {
      setError('Выберите получателя для сегмента');
      return;
    }
    setSending(true);
    try {
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, link: link || undefined, linkLabel: linkLabel || undefined, category, audience }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'Fehler');
      setResult(d.recipientCount);
      setTitle('');
      setBody('');
      setLink('');
      setLinkLabel('');
      setSelectedCustomer(null);
      setCustomerQuery('');
      loadCampaigns();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <h1 className="mb-6 flex items-center text-2xl font-bold">
        <Megaphone className="mr-2 h-6 w-6 text-primary-600" /> Уведомления
      </h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Compose */}
        <form onSubmit={send} className="space-y-4 rounded-lg bg-white p-6 shadow-sm">
          <div>
            <label className="mb-1 block text-sm font-medium">Заголовок</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border px-3 py-2"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Текст</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              className="w-full rounded-md border px-3 py-2"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Ссылка (необязательно)</label>
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="/angebote/..."
                className="w-full rounded-md border px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Текст ссылки</label>
              <input
                value={linkLabel}
                onChange={(e) => setLinkLabel(e.target.value)}
                placeholder="Zum Angebot"
                className="w-full rounded-md border px-3 py-2"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Категория</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-md border px-3 py-2"
            >
              <option value="promo">Акция</option>
              <option value="loyalty">Баллы</option>
              <option value="order">Заказ</option>
              <option value="system">Система</option>
            </select>
          </div>

          {/* Audience */}
          <div className="rounded-md border p-3">
            <p className="mb-2 text-sm font-medium">Кому отправить</p>
            <div className="space-y-2">
              {(Object.keys(AUDIENCE_LABEL) as AudienceType[]).map((typ) => (
                <label key={typ} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="audience"
                    checked={audienceType === typ}
                    onChange={() => setAudienceType(typ)}
                  />
                  {AUDIENCE_LABEL[typ]}
                </label>
              ))}
            </div>

            {audienceType === 'customer' && (
              <div className="mt-3">
                {selectedCustomer ? (
                  <div className="flex items-center justify-between rounded-md bg-primary-50 px-3 py-2 text-sm">
                    <span>
                      {selectedCustomer.name} · {selectedCustomer.phoneNumber}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedCustomer(null)}
                      className="text-red-600"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      value={customerQuery}
                      onChange={(e) => setCustomerQuery(e.target.value)}
                      placeholder="Поиск клиента..."
                      className="w-full rounded-md border px-3 py-2 text-sm"
                    />
                    {customerResults.length > 0 && (
                      <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border">
                        {customerResults.map((c) => (
                          <li key={c.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCustomer(c);
                                setCustomerResults([]);
                              }}
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                            >
                              {c.name} · {c.phoneNumber}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            )}

            {audienceType === 'inactive' && (
              <div className="mt-3 flex items-center gap-2 text-sm">
                Не заказывали более
                <input
                  type="number"
                  min={1}
                  value={inactiveDays}
                  onChange={(e) => setInactiveDays(Number(e.target.value))}
                  className="w-20 rounded-md border px-2 py-1"
                />
                дней
              </div>
            )}

            {audienceType === 'product' && (
              <div className="mt-3 space-y-2 text-sm">
                <select
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  className="w-full rounded-md border px-3 py-2"
                >
                  <option value="">— выберите товар —</option>
                  {products.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  Минимум
                  <input
                    type="number"
                    min={1}
                    value={minCount}
                    onChange={(e) => setMinCount(Number(e.target.value))}
                    className="w-20 rounded-md border px-2 py-1"
                  />
                  заказ(ов) с этим товаром
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {result !== null && (
            <p className="flex items-center text-sm text-green-600">
              <CheckCircle2 className="mr-1 h-4 w-4" /> Отправлено: {result} получателям
            </p>
          )}

          <button
            type="submit"
            disabled={sending}
            className="flex w-full items-center justify-center rounded-md bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Отправить
          </button>
        </form>

        {/* History */}
        <div className="rounded-lg bg-white p-6 shadow-sm">
          <h2 className="mb-4 font-semibold">История рассылок</h2>
          {campaigns.length === 0 ? (
            <p className="text-sm text-gray-500">Пока нет рассылок.</p>
          ) : (
            <ul className="divide-y">
              {campaigns.map((c) => (
                <li key={c.campaignId} className="py-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium">{c.title}</p>
                      <p className="text-xs text-gray-500">
                        {AUDIENCE_LABEL[c.audience] || c.audience} ·{' '}
                        {new Date(c.createdAt).toLocaleDateString('de-DE')}
                      </p>
                    </div>
                    <div className="text-right text-xs text-gray-600">
                      <p>{c.recipientCount} получ.</p>
                      <p className="text-green-600">{c.readCount} прочит.</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
