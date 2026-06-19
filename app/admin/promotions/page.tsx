"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Gift,
  Percent,
  Euro,
  Copy,
  PlusCircle,
  ArrowLeft,
  Pencil,
  Trash2,
  BarChart3,
} from 'lucide-react';
import { getPromotionsAdmin, deletePromotion } from '../../../lib/api-client';

const TYPE_CARDS = [
  {
    type: 'gratis_article',
    title: 'Gratis-Artikel',
    description: 'Geschenk beim Kauf oder ab Mindestbestellwert',
    icon: Gift,
    color: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  },
  {
    type: 'percent_discount',
    title: '% Rabatt',
    description: 'Prozent auf Bestellung oder ausgewählte Produkte',
    icon: Percent,
    color: 'bg-blue-50 border-blue-200 text-blue-800',
  },
  {
    type: 'fixed_discount',
    title: '€ Rabatt',
    description: 'Fester Betrag auf ausgewählte Produkte',
    icon: Euro,
    color: 'bg-amber-50 border-amber-200 text-amber-800',
  },
  {
    type: 'bogo',
    title: '2 Artikel zum Preis von 1',
    description: '2 für 1 oder zweiter Artikel 50 %',
    icon: Copy,
    color: 'bg-purple-50 border-purple-200 text-purple-800',
  },
] as const;

const LIFECYCLE_LABELS: Record<string, string> = {
  active: 'Aktiv',
  scheduled: 'Geplant',
  expired: 'Abgelaufen',
};

export default function PromotionsAdminPage() {
  const searchParams = useSearchParams();
  const selectedType = searchParams.get('type');
  const [allPromotions, setAllPromotions] = useState<any[]>([]);
  const [promotions, setPromotions] = useState<any[]>([]);
  const [hubLoading, setHubLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPromotionsAdmin()
      .then((res) => {
        if (res.success) setAllPromotions(res.promotions || []);
      })
      .catch(() => {})
      .finally(() => setHubLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedType) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await getPromotionsAdmin({ type: selectedType });
        if (res.success) setPromotions(res.promotions);
        else setError(res.error || 'Fehler beim Laden');
      } catch {
        setError('Fehler beim Laden');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [selectedType]);

  const countByLifecycle = (type: string, lifecycle: string) => {
    if (hubLoading) return '…';
    return allPromotions.filter((p) => p.type === type && p.lifecycle === lifecycle).length;
  };

  const analyticsTotals = allPromotions.reduce(
    (acc, p) => ({
      views: acc.views + (p.viewCount || 0),
      clicks: acc.clicks + (p.clickCount || 0),
      orders: acc.orders + (p.orderCount || 0),
      revenue: acc.revenue + (p.revenueTotal || 0),
    }),
    { views: 0, clicks: 0, orders: 0, revenue: 0 }
  );

  const handleDelete = async (id: string) => {
    if (!confirm('Aktion wirklich löschen?')) return;
    const res = await deletePromotion(id);
    if (res.success) {
      setPromotions((prev) => prev.filter((p) => p.id !== id));
      setAllPromotions((prev) => prev.filter((p) => p.id !== id));
    } else setError(res.error || 'Löschen fehlgeschlagen');
  };

  if (selectedType) {
    const card = TYPE_CARDS.find((c) => c.type === selectedType);
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <Link href="/admin/promotions" className="inline-flex items-center text-sm text-gray-600 mb-4 hover:text-primary-600">
          <ArrowLeft className="h-4 w-4 mr-1" /> Zurück zu Angebote
        </Link>
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">{card?.title || selectedType}</h1>
          <Link
            href={`/admin/promotions/new?type=${selectedType}`}
            className="flex items-center bg-primary-600 text-white px-4 py-2 rounded-md hover:bg-primary-700"
          >
            <PlusCircle className="h-5 w-5 mr-2" />
            Neues Angebot hinzufügen
          </Link>
        </div>
        {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded">{error}</div>}
        {loading ? (
          <p className="text-gray-500">Laden…</p>
        ) : promotions.length === 0 ? (
          <p className="text-gray-500">Keine Aktionen in dieser Kategorie.</p>
        ) : (
          <div className="space-y-3">
            {promotions.map((p) => (
              <div key={p.id} className="border rounded-lg p-4 flex justify-between items-start bg-white shadow-sm">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold">{p.name}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        p.lifecycle === 'active'
                          ? 'bg-green-100 text-green-800'
                          : p.lifecycle === 'scheduled'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {LIFECYCLE_LABELS[p.lifecycle] || p.lifecycle}
                    </span>
                  </div>
                  {p.internalName && <p className="text-sm text-gray-500">{p.internalName}</p>}
                  <p className="text-sm text-gray-600 mt-1">
                    {new Date(p.validFrom).toLocaleString('de-DE')} – {new Date(p.validTo).toLocaleString('de-DE')}
                  </p>
                  <p className="text-xs text-gray-500 mt-2">
                    Views {p.viewCount || 0} · Klicks {p.clickCount || 0} · Bestellungen {p.orderCount || 0}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link href={`/admin/promotions/edit/${p.id}`} className="p-2 text-gray-600 hover:text-primary-600">
                    <Pencil className="h-4 w-4" />
                  </Link>
                  <button type="button" onClick={() => handleDelete(p.id)} className="p-2 text-gray-600 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold">Angebote / Aktionen</h1>
          <p className="text-gray-600 mt-1">Automatische Rabatte für Website und App</p>
        </div>
        <Link
          href="/admin/promotions/new"
          className="flex items-center bg-primary-600 text-white px-4 py-2 rounded-md hover:bg-primary-700"
        >
          <PlusCircle className="h-5 w-5 mr-2" />
          Neues Angebot hinzufügen
        </Link>
      </div>

      {!hubLoading && (
        <div className="mb-8 border rounded-xl p-5 bg-white shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="h-5 w-5 text-primary-600" />
            <h2 className="font-bold text-lg">Analytics (gesamt)</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-gray-500">Aufrufe (Badges/PDP)</div>
              <div className="text-2xl font-bold">{analyticsTotals.views}</div>
            </div>
            <div>
              <div className="text-gray-500">Klicks</div>
              <div className="text-2xl font-bold">{analyticsTotals.clicks}</div>
            </div>
            <div>
              <div className="text-gray-500">Bestellungen</div>
              <div className="text-2xl font-bold">{analyticsTotals.orders}</div>
            </div>
            <div>
              <div className="text-gray-500">Umsatz (Rabatt)</div>
              <div className="text-2xl font-bold">{analyticsTotals.revenue.toFixed(2)} €</div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {TYPE_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.type}
              href={`/admin/promotions?type=${card.type}`}
              className={`border-2 rounded-xl p-6 hover:shadow-md transition-shadow ${card.color}`}
            >
              <div className="flex items-start gap-4">
                <Icon className="h-10 w-10 shrink-0" />
                <div className="flex-1">
                  <h2 className="text-xl font-bold mb-1">{card.title}</h2>
                  <p className="text-sm opacity-90 mb-4">{card.description}</p>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <div className="font-semibold">Aktiv</div>
                      <div>{countByLifecycle(card.type, 'active')}</div>
                    </div>
                    <div>
                      <div className="font-semibold">Geplant</div>
                      <div>{countByLifecycle(card.type, 'scheduled')}</div>
                    </div>
                    <div>
                      <div className="font-semibold">Abgelaufen</div>
                      <div>{countByLifecycle(card.type, 'expired')}</div>
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
