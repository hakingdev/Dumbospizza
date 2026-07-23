"use client";

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import { createPromotion } from '../../../../lib/api-client';
import { getProducts, getCategories } from '../../../../lib/api-client';
import {
  PromotionScheduleFields,
  PromotionCampaignFields,
  defaultScheduleCampaignFields,
} from '../../../../components/admin/PromotionScheduleCampaign';
import PromoItemSelector, { PromoItem } from '../../../../components/admin/PromoItemSelector';
import { SafeImage } from '../../../../components/SafeImage';

const TYPE_LABELS: Record<string, string> = {
  gratis_article: 'Gratis-Artikel',
  percent_discount: '% Rabatt',
  fixed_discount: '€ Rabatt',
  bogo: '2+1 — 3. Artikel gratis / 50 %',
};

export default function NewPromotionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialType = searchParams.get('type') || 'percent_discount';

  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    internalName: '',
    description: '',
    type: initialType,
    enabled: true,
    validFrom: new Date().toISOString().slice(0, 16),
    validTo: '',
    scope: 'products' as 'order' | 'products',
    percentValue: 10,
    fixedValue: 3,
    minOrderAmount: '',
    gratisTrigger: 'buy_product' as 'buy_product' | 'min_order',
    giftProductId: '',
    giftProductName: '',
    giftProductIds: [] as string[],
    giftItems: [] as PromoItem[],
    bogoMode: 'free' as 'free' | 'half_price',
    targetProductIds: [] as string[],
    targetCategoryIds: [] as string[],
    targetItems: [] as PromoItem[],
    rewardItems: [] as PromoItem[],
    showInModal: true,
    showOnOffersPage: true,
    badgeText: '',
    seoTitle: '',
    seoDescription: '',
    promoCode: '',
    audience: 'all' as 'all' | 'new_customers' | 'returning' | 'vip' | 'app_only' | 'web_only',
    channel: 'all' as 'all' | 'web' | 'app',
    image: '',
    bannerImage: '',
    ...defaultScheduleCampaignFields,
  });

  const uploadImage = async (file: File, field: 'image' | 'bannerImage') => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('folder', 'promotions');
    const res = await fetch('/api/admin/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.success) setForm((prev) => ({ ...prev, [field]: data.path }));
    else setError(data.error || 'Upload fehlgeschlagen');
  };

  useEffect(() => {
    Promise.all([getProducts({ available: true }), getCategories({ active: true })]).then(
      ([pRes, cRes]) => {
        if (pRes.success) setProducts(pRes.products || []);
        if (cRes.success) setCategories(cRes.categories || []);
      }
    );
  }, []);

  const toggleId = (field: 'targetProductIds' | 'targetCategoryIds' | 'giftProductIds', id: string) => {
    setForm((prev) => {
      const list = prev[field];
      return {
        ...prev,
        [field]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
      };
    });
  };

  const showTargetSelection =
    (form.type === 'fixed_discount' && form.scope === 'products') ||
    form.type === 'bogo' ||
    (form.type === 'percent_discount' && form.scope === 'products') ||
    (form.type === 'gratis_article' && form.gratisTrigger === 'buy_product');

  const showMinOrder =
    (form.type === 'percent_discount' && form.scope === 'order') ||
    (form.type === 'fixed_discount' && form.scope === 'order') ||
    (form.type === 'gratis_article' && form.gratisTrigger === 'min_order');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) {
      setError('Name ist Pflichtfeld');
      return;
    }
    if (form.type === 'gratis_article' && form.giftItems.length === 0) {
      setError('Mindestens ein Gratis-Produkt auswählen');
      return;
    }
    setSubmitting(true);
    try {
      const validFrom = form.validFrom
        ? new Date(form.validFrom).toISOString()
        : new Date().toISOString();
      const validTo = form.validTo
        ? new Date(form.validTo).toISOString()
        : new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000).toISOString();

      const giftProductIds: string[] = Array.from(
        new Set((form.giftItems || []).map((it) => String(it.productId)))
      );
      const payload = {
        ...form,
        minOrderAmount: form.minOrderAmount === '' ? undefined : Number(form.minOrderAmount),
        giftItems: form.giftItems,
        giftProductIds,
        giftProductId: giftProductIds[0] || undefined,
        giftProductName:
          giftProductIds.length === 1
            ? products.find((p) => p._id === giftProductIds[0])?.name
            : undefined,
        validFrom,
        validTo,
      };
      const res = await createPromotion(payload);
      if (res.success) router.push('/admin/promotions?type=' + form.type);
      else setError(res.error || 'Speichern fehlgeschlagen');
    } catch {
      setError('Speichern fehlgeschlagen');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Link href="/admin/promotions" className="inline-flex items-center text-sm text-gray-600 mb-4">
        <ArrowLeft className="h-4 w-4 mr-1" /> Angebote
      </Link>
      <h1 className="text-2xl font-bold mb-6">Neues Angebot — {TYPE_LABELS[form.type] || form.type}</h1>
      {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-6 bg-white border rounded-lg p-6 shadow-sm">
        <div>
          <label className="block text-sm font-medium mb-1">Typ</label>
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="w-full border rounded-md px-3 py-2"
          >
            {Object.entries(TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Name (öffentlich) *</label>
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full border rounded-md px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Interner Name</label>
          <input
            value={form.internalName}
            onChange={(e) => setForm({ ...form, internalName: e.target.value })}
            className="w-full border rounded-md px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Beschreibung</label>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full border rounded-md px-3 py-2"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Kampagnen-Start (optional)</label>
            <input
              type="datetime-local"
              value={form.validFrom}
              onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
              className="w-full border rounded-md px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Kampagnen-Ende (optional)</label>
            <input
              type="datetime-local"
              value={form.validTo}
              onChange={(e) => setForm({ ...form, validTo: e.target.value })}
              className="w-full border rounded-md px-3 py-2"
            />
            <p className="text-xs text-gray-500 mt-1">
              Bei Wochentags-Plan leer lassen = 10 Jahre aktiv. Hauptsteuerung: Mo–So oben.
            </p>
          </div>
        </div>

        {(form.type === 'percent_discount' || form.type === 'fixed_discount') && (
          <div>
            <label className="block text-sm font-medium mb-1">Gültig für</label>
            <select
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value as 'order' | 'products' })}
              className="w-full border rounded-md px-3 py-2"
            >
              <option value="order">Gesamte Bestellung (ab Mindestbestellwert)</option>
              <option value="products">Ausgewählte Produkte/Kategorien</option>
            </select>
          </div>
        )}

        {form.type === 'percent_discount' && (
          <div>
            <label className="block text-sm font-medium mb-1">Prozent %</label>
            <input
              type="number"
              min={1}
              max={100}
              value={form.percentValue}
              onChange={(e) => setForm({ ...form, percentValue: Number(e.target.value) })}
              className="w-full border rounded-md px-3 py-2"
            />
          </div>
        )}

        {form.type === 'fixed_discount' && (
          <div>
            <label className="block text-sm font-medium mb-1">
              {form.scope === 'order' ? 'Rabatt € auf die Bestellung' : 'Rabatt € pro Artikel'}
            </label>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={form.fixedValue}
              onChange={(e) => setForm({ ...form, fixedValue: Number(e.target.value) })}
              className="w-full border rounded-md px-3 py-2"
            />
            {form.scope === 'order' && (
              <p className="text-xs text-gray-500 mt-1">
                Fester Rabatt auf den Bestellwert (z. B. ab 30 € → 4 € Rabatt). Mindestbestellwert unten.
              </p>
            )}
          </div>
        )}

        {form.type === 'bogo' && (
          <div>
            <label className="block text-sm font-medium mb-1">Modus</label>
            <select
              value={form.bogoMode}
              onChange={(e) => setForm({ ...form, bogoMode: e.target.value as 'free' | 'half_price' })}
              className="w-full border rounded-md px-3 py-2"
            >
              <option value="free">Dritter Artikel gratis (2+1)</option>
              <option value="half_price">Dritter Artikel 50 % (2+1)</option>
            </select>

            <div className="mt-4">
              <label className="block text-sm font-medium mb-1">Qualifizierte Artikel</label>
              <p className="text-xs text-gray-500 mb-2">
                Какие товары и размеры участвуют. Каждые 2 купленные единицы из этого списка
                дают 1 награду (2+1).
              </p>
              <PromoItemSelector
                products={products}
                categories={categories}
                value={form.targetItems}
                onChange={(v) => setForm({ ...form, targetItems: v })}
              />
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium mb-1">
                {form.bogoMode === 'free' ? 'Belohnung: Artikel gratis' : 'Belohnung: Artikel zum halben Preis'}
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Награда за 2 купленных товара — её выбирает ресторан: обычно ОДНА позиция
                (товар+размер), клиент её только подтверждает ({form.bogoMode === 'free' ? 'бесплатно' : 'за полцены'}).
                Несколько позиций = клиент выберет одну из списка.
              </p>
              <PromoItemSelector
                products={products}
                categories={categories}
                value={form.rewardItems}
                onChange={(v) => setForm({ ...form, rewardItems: v })}
              />
            </div>
          </div>
        )}

        {form.type === 'gratis_article' && (
          <>
            <div>
              <label className="block text-sm font-medium mb-1">Bedingung</label>
              <select
                value={form.gratisTrigger}
                onChange={(e) =>
                  setForm({ ...form, gratisTrigger: e.target.value as 'buy_product' | 'min_order' })
                }
                className="w-full border rounded-md px-3 py-2"
              >
                <option value="buy_product">Beim Kauf bestimmter Produkte</option>
                <option value="min_order">Ab Mindestbestellwert</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Gratis-Produkte (Kunde wählt 1 aus)
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Kategorie, einzelne Produkte oder konkrete Größen/Varianten wählen. Der Kunde wählt eins als Geschenk.
              </p>
              <PromoItemSelector
                products={products}
                categories={categories}
                value={form.giftItems}
                onChange={(v) => setForm({ ...form, giftItems: v })}
              />
              {form.giftItems.length > 0 && (
                <p className="text-xs text-gray-600 mt-1">
                  {form.giftItems.length} Position(en) — Kunde wählt genau 1
                </p>
              )}
            </div>
          </>
        )}

        {showTargetSelection && form.type !== 'bogo' && (
          <>
            <div>
              <label className="block text-sm font-medium mb-1">Produkte</label>
              <p className="text-xs text-gray-500 mb-2">Einzelne Artikel — optional, wenn Kategorie reicht.</p>
              <div className="max-h-40 overflow-y-auto border rounded-md p-2 space-y-1">
                {products.map((p) => (
                  <label key={p._id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.targetProductIds.includes(p._id)}
                      onChange={() => toggleId('targetProductIds', p._id)}
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Kategorien</label>
              <p className="text-xs text-gray-500 mb-2">
                Kategorie ankreuzen = alle Artikel dieser Kategorie sind betroffen (ohne einzelne Produkte).
              </p>
              <div className="max-h-32 overflow-y-auto border rounded-md p-2 space-y-1">
                {categories.map((c) => (
                  <label key={c._id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.targetCategoryIds.includes(c._id)}
                      onChange={() => toggleId('targetCategoryIds', c._id)}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        {showMinOrder && (
          <div>
            <label className="block text-sm font-medium mb-1">Mindestbestellwert €</label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={form.minOrderAmount}
              onChange={(e) => setForm({ ...form, minOrderAmount: e.target.value })}
              className="w-full border rounded-md px-3 py-2"
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Zielgruppe</label>
            <select
              value={form.audience}
              onChange={(e) =>
                setForm({ ...form, audience: e.target.value as typeof form.audience })
              }
              className="w-full border rounded-md px-3 py-2"
            >
              <option value="all">Alle Kunden</option>
              <option value="new_customers">Neukunden (keine Bestellung)</option>
              <option value="returning">Stammkunden</option>
              <option value="vip">VIP (Loyalty)</option>
              <option value="app_only">Nur App</option>
              <option value="web_only">Nur Website</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Kanal</label>
            <select
              value={form.channel}
              onChange={(e) => setForm({ ...form, channel: e.target.value as typeof form.channel })}
              className="w-full border rounded-md px-3 py-2"
            >
              <option value="all">Website + App</option>
              <option value="web">Nur Website</option>
              <option value="app">Nur App</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Aktionscode (optional)</label>
          <input
            value={form.promoCode}
            onChange={(e) => setForm({ ...form, promoCode: e.target.value.toUpperCase() })}
            placeholder="Nur bei Eingabe dieses Codes"
            className="w-full border rounded-md px-3 py-2"
          />
          <p className="text-xs text-gray-500 mt-1">Leer = automatisch ohne Code. Mit Code = zusätzliche Schicht (legacy Gutscheine bleiben separat).</p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Badge-Text</label>
          <input
            value={form.badgeText}
            onChange={(e) => setForm({ ...form, badgeText: e.target.value })}
            placeholder="z. B. -20 % oder GRATIS"
            className="w-full border rounded-md px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">SEO-Titel</label>
          <input value={form.seoTitle} onChange={(e) => setForm({ ...form, seoTitle: e.target.value })} className="w-full border rounded-md px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">SEO-Beschreibung</label>
          <textarea rows={2} value={form.seoDescription} onChange={(e) => setForm({ ...form, seoDescription: e.target.value })} className="w-full border rounded-md px-3 py-2" />
        </div>

        <PromotionScheduleFields form={form} setForm={(patch) => setForm({ ...form, ...patch })} />
        <PromotionCampaignFields form={form} setForm={(patch) => setForm({ ...form, ...patch })} />
        <p className="text-xs text-gray-500">E-Mail/Push-Versand ist nach dem Speichern auf der Bearbeiten-Seite möglich.</p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Bild (Modal)</label>
            {form.image && <SafeImage src={form.image} alt="" className="h-20 mb-2 rounded object-cover" />}
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0], 'image')} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Banner (/angebote)</label>
            {form.bannerImage && <SafeImage src={form.bannerImage} alt="" className="h-20 mb-2 rounded object-cover" />}
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0], 'bannerImage')} />
          </div>
        </div>

        <div className="flex gap-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.showInModal}
              onChange={(e) => setForm({ ...form, showInModal: e.target.checked })}
            />
            Im Modal anzeigen
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.showOnOffersPage}
              onChange={(e) => setForm({ ...form, showOnOffersPage: e.target.checked })}
            />
            Auf /angebote
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            Aktiv
          </label>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="flex items-center bg-primary-600 text-white px-6 py-2 rounded-md hover:bg-primary-700 disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Save className="h-5 w-5 mr-2" />}
          Speichern
        </button>
      </form>
    </div>
  );
}
