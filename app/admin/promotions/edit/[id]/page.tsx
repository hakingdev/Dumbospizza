"use client";

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import { getPromotionAdminById, updatePromotion, getProducts, getCategories } from '../../../../../lib/api-client';
import {
  PromotionScheduleFields,
  PromotionCampaignFields,
  PromotionCampaignActions,
  defaultScheduleCampaignFields,
} from '../../../../../components/admin/PromotionScheduleCampaign';
import PromoItemSelector from '../../../../../components/admin/PromoItemSelector';
import { SafeImage } from '../../../../../components/SafeImage';

const TYPE_LABELS: Record<string, string> = {
  gratis_article: 'Gratis-Artikel',
  percent_discount: '% Rabatt',
  fixed_discount: '€ Rabatt',
  bogo: '2+1 — 3. Artikel gratis / 50 %',
};

export default function EditPromotionPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      getPromotionAdminById(id),
      getProducts({ available: true }),
      getCategories({ active: true }),
    ]).then(([pRes, prodRes, catRes]) => {
      if (prodRes.success) setProducts(prodRes.products || []);
      if (catRes.success) setCategories(catRes.categories || []);
      if (pRes.success && pRes.promotion) {
        const p = pRes.promotion;
        setForm({
          name: p.name || '',
          internalName: p.internalName || '',
          description: p.description || '',
          type: p.type,
          enabled: p.enabled !== false,
          validFrom: p.validFrom ? new Date(p.validFrom).toISOString().slice(0, 16) : '',
          validTo: p.validTo ? new Date(p.validTo).toISOString().slice(0, 16) : '',
          scope: p.scope || 'products',
          percentValue: p.percentValue ?? 10,
          fixedValue: p.fixedValue ?? 3,
          minOrderAmount: p.minOrderAmount ?? '',
          gratisTrigger: p.gratisTrigger || 'buy_product',
          giftProductId: p.giftProductId || '',
          giftProductName: p.giftProductName || '',
          giftProductIds: p.giftProductIds?.length
            ? p.giftProductIds
            : p.giftProductId
              ? [p.giftProductId]
              : [],
          // Точный выбор подарка (товар+размер). Легаси giftProductIds → giftItems без размеров.
          giftItems: p.giftItems?.length
            ? p.giftItems
            : (p.giftProductIds || []).map((id: string) => ({ productId: id, sizeName: '' })),
          bogoMode: p.bogoMode || 'free',
          targetProductIds: p.targetProductIds || [],
          targetCategoryIds: p.targetCategoryIds || [],
          targetItems: p.targetItems || [],
          rewardItems: p.rewardItems || [],
          showInModal: p.showInModal !== false,
          showOnOffersPage: p.showOnOffersPage !== false,
          badgeText: p.badgeText || '',
          seoTitle: p.seoTitle || '',
          seoDescription: p.seoDescription || '',
          promoCode: p.promoCode || '',
          audience: p.audience || 'all',
          channel: p.channel || 'all',
          image: p.image || '',
          bannerImage: p.bannerImage || '',
          ...defaultScheduleCampaignFields,
          weekdayScheduleEnabled: p.weekdayScheduleEnabled !== false,
          happyHourEnabled: p.happyHourEnabled === true,
          activeDaysOfWeek: p.activeDaysOfWeek || defaultScheduleCampaignFields.activeDaysOfWeek,
          activeTimeStart: p.activeTimeStart || defaultScheduleCampaignFields.activeTimeStart,
          activeTimeEnd: p.activeTimeEnd || defaultScheduleCampaignFields.activeTimeEnd,
          scheduleTimeZone: p.scheduleTimeZone || defaultScheduleCampaignFields.scheduleTimeZone,
          autoNotifyOnStart: p.autoNotifyOnStart === true,
          emailCampaignEnabled: p.emailCampaignEnabled === true,
          emailSubject: p.emailSubject || '',
          emailBodyHtml: p.emailBodyHtml || '',
          pushCampaignEnabled: p.pushCampaignEnabled === true,
          pushTitle: p.pushTitle || '',
          pushBody: p.pushBody || '',
        });
        setAnalytics({
          viewCount: p.viewCount || 0,
          modalOpenCount: p.modalOpenCount || 0,
          clickCount: p.clickCount || 0,
          orderCount: p.orderCount || 0,
          usageCount: p.usageCount || 0,
          revenueTotal: p.revenueTotal || 0,
        });
      } else setError('Aktion nicht gefunden');
      setLoading(false);
    });
  }, [id]);

  const uploadImage = async (file: File, field: 'image' | 'bannerImage') => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('folder', 'promotions');
    const res = await fetch('/api/admin/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.success) setForm((prev: any) => ({ ...prev, [field]: data.path }));
    else setError(data.error || 'Upload fehlgeschlagen');
  };

  const toggleId = (field: 'targetProductIds' | 'targetCategoryIds' | 'giftProductIds', pid: string) => {
    setForm((prev: any) => ({
      ...prev,
      [field]: prev[field].includes(pid) ? prev[field].filter((x: string) => x !== pid) : [...prev[field], pid],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (form.type === 'gratis_article' && (form.giftItems?.length || 0) === 0) {
      setError('Mindestens ein Gratis-Produkt auswählen');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const giftProductIds: string[] = Array.from(
        new Set((form.giftItems || []).map((it: any) => String(it.productId)))
      );
      const payload = {
        ...form,
        minOrderAmount: form.minOrderAmount === '' ? undefined : Number(form.minOrderAmount),
        giftItems: form.giftItems || [],
        giftProductIds,
        giftProductId: giftProductIds[0] || undefined,
        giftProductName:
          giftProductIds.length === 1
            ? products.find((p) => p._id === giftProductIds[0])?.name
            : undefined,
        promoCode: form.promoCode?.trim() || undefined,
        validFrom: form.validFrom
          ? new Date(form.validFrom).toISOString()
          : new Date().toISOString(),
        validTo: form.validTo
          ? new Date(form.validTo).toISOString()
          : new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000).toISOString(),
      };
      const res = await updatePromotion(id, payload);
      if (res.success) router.push('/admin/promotions?type=' + form.type);
      else setError(res.error || 'Speichern fehlgeschlagen');
    } catch {
      setError('Speichern fehlgeschlagen');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !form) {
    return <div className="p-6">{loading ? 'Laden…' : error || 'Fehler'}</div>;
  }

  const showTargetSelection =
    (form.type === 'fixed_discount' && form.scope === 'products') ||
    form.type === 'bogo' ||
    (form.type === 'percent_discount' && form.scope === 'products') ||
    (form.type === 'gratis_article' && form.gratisTrigger === 'buy_product');

  const showMinOrder =
    (form.type === 'percent_discount' && form.scope === 'order') ||
    (form.type === 'fixed_discount' && form.scope === 'order') ||
    (form.type === 'gratis_article' && form.gratisTrigger === 'min_order');

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Link href={`/admin/promotions?type=${form.type}`} className="inline-flex items-center text-sm text-gray-600 mb-4">
        <ArrowLeft className="h-4 w-4 mr-1" /> Angebote
      </Link>
      <h1 className="text-2xl font-bold mb-6">Bearbeiten — {TYPE_LABELS[form.type]}</h1>
      {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-6 bg-white border rounded-lg p-6 shadow-sm">
        <div>
          <label className="block text-sm font-medium mb-1">Name *</label>
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border rounded-md px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Interner Name</label>
          <input value={form.internalName} onChange={(e) => setForm({ ...form, internalName: e.target.value })} className="w-full border rounded-md px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Beschreibung</label>
          <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full border rounded-md px-3 py-2" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Start *</label>
            <input type="datetime-local" required value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} className="w-full border rounded-md px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Ende *</label>
            <input type="datetime-local" required value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} className="w-full border rounded-md px-3 py-2" />
          </div>
        </div>

        {(form.type === 'percent_discount' || form.type === 'fixed_discount') && (
          <div>
            <label className="block text-sm font-medium mb-1">Gültig für</label>
            <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} className="w-full border rounded-md px-3 py-2">
              <option value="order">Gesamte Bestellung (ab Mindestbestellwert)</option>
              <option value="products">Ausgewählte Produkte</option>
            </select>
          </div>
        )}

        {form.type === 'percent_discount' && (
          <div>
            <label className="block text-sm font-medium mb-1">Prozent %</label>
            <input type="number" min={1} max={100} value={form.percentValue} onChange={(e) => setForm({ ...form, percentValue: Number(e.target.value) })} className="w-full border rounded-md px-3 py-2" />
          </div>
        )}

        {form.type === 'fixed_discount' && (
          <div>
            <label className="block text-sm font-medium mb-1">
              {form.scope === 'order' ? 'Rabatt € auf die Bestellung' : 'Rabatt € pro Artikel'}
            </label>
            <input type="number" step={0.01} value={form.fixedValue} onChange={(e) => setForm({ ...form, fixedValue: Number(e.target.value) })} className="w-full border rounded-md px-3 py-2" />
            {form.scope === 'order' && (
              <p className="text-xs text-gray-500 mt-1">
                Fester Rabatt auf den Bestellwert (z. B. ab 30 € → 4 € Rabatt). Mindestbestellwert unten.
              </p>
            )}
          </div>
        )}

        {form.type === 'bogo' && (
          <div>
            <select value={form.bogoMode} onChange={(e) => setForm({ ...form, bogoMode: e.target.value })} className="w-full border rounded-md px-3 py-2">
              <option value="free">Dritter Artikel gratis (2+1)</option>
              <option value="half_price">Dritter Artikel 50 % (2+1)</option>
            </select>

            <div className="mt-4">
              <label className="block text-sm font-medium mb-1">Qualifizierte Artikel</label>
              <p className="text-xs text-gray-500 mb-2">
                Какие товары и размеры участвуют. Каждые 2 купленные единицы дают 1 награду (2+1).
              </p>
              <PromoItemSelector
                products={products}
                categories={categories}
                value={form.targetItems || []}
                onChange={(v) => setForm({ ...form, targetItems: v })}
              />
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium mb-1">
                {form.bogoMode === 'free' ? 'Belohnung: Artikel gratis' : 'Belohnung: Artikel zum halben Preis'}
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Награда за 2 купленных товара — выбирает ресторан: обычно ОДНА позиция
                (товар+размер), клиент только подтверждает. Несколько позиций = клиент выберет одну.
              </p>
              <PromoItemSelector
                products={products}
                categories={categories}
                value={form.rewardItems || []}
                onChange={(v) => setForm({ ...form, rewardItems: v })}
              />
            </div>
          </div>
        )}

        {form.type === 'gratis_article' && (
          <>
            <select value={form.gratisTrigger} onChange={(e) => setForm({ ...form, gratisTrigger: e.target.value })} className="w-full border rounded-md px-3 py-2">
              <option value="buy_product">Beim Kauf bestimmter Produkte</option>
              <option value="min_order">Ab Mindestbestellwert</option>
            </select>
            <div>
              <label className="block text-sm font-medium mb-1">
                Gratis-Produkte (Kunde wählt 1 aus)
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Kategorie, einzelne Produkte oder konkrete Größen/Varianten wählen.
              </p>
              <PromoItemSelector
                products={products}
                categories={categories}
                value={form.giftItems || []}
                onChange={(v) => setForm({ ...form, giftItems: v })}
              />
            </div>
          </>
        )}

        {showTargetSelection && form.type !== 'bogo' && (
          <>
            <div>
              <label className="block text-sm font-medium mb-1">Produkte</label>
              <p className="text-xs text-gray-500 mb-2">Optional — nur wenn nicht die ganze Kategorie.</p>
            </div>
            <div className="max-h-40 overflow-y-auto border rounded p-2">
              {products.map((p) => (
                <label key={p._id} className="flex gap-2 text-sm">
                  <input type="checkbox" checked={form.targetProductIds.includes(p._id)} onChange={() => toggleId('targetProductIds', p._id)} />
                  {p.name}
                </label>
              ))}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Kategorien</label>
              <p className="text-xs text-gray-500 mb-2">
                Kategorie = alle Artikel darin (Pizza 1, Pizza 2, … automatisch).
              </p>
            </div>
            <div className="max-h-32 overflow-y-auto border rounded p-2">
              {categories.map((c) => (
                <label key={c._id} className="flex gap-2 text-sm">
                  <input type="checkbox" checked={form.targetCategoryIds.includes(c._id)} onChange={() => toggleId('targetCategoryIds', c._id)} />
                  {c.name}
                </label>
              ))}
            </div>
          </>
        )}

        {showMinOrder && (
          <div>
            <label className="block text-sm font-medium mb-1">Mindestbestellwert €</label>
            <input type="number" step={0.01} placeholder="z. B. 30" value={form.minOrderAmount} onChange={(e) => setForm({ ...form, minOrderAmount: e.target.value })} className="w-full border rounded-md px-3 py-2" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Zielgruppe</label>
            <select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} className="w-full border rounded-md px-3 py-2">
              <option value="all">Alle Kunden</option>
              <option value="new_customers">Neukunden</option>
              <option value="returning">Stammkunden</option>
              <option value="vip">VIP (Loyalty)</option>
              <option value="app_only">Nur App</option>
              <option value="web_only">Nur Website</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Kanal</label>
            <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} className="w-full border rounded-md px-3 py-2">
              <option value="all">Website + App</option>
              <option value="web">Nur Website</option>
              <option value="app">Nur App</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Aktionscode (optional)</label>
          <input value={form.promoCode} onChange={(e) => setForm({ ...form, promoCode: e.target.value.toUpperCase() })} className="w-full border rounded-md px-3 py-2" />
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

        <div className="grid grid-cols-2 gap-4">
          <div>
            {form.image && <SafeImage src={form.image} alt="" className="h-20 mb-2 rounded object-cover" />}
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0], 'image')} />
          </div>
          <div>
            {form.bannerImage && <SafeImage src={form.bannerImage} alt="" className="h-20 mb-2 rounded object-cover" />}
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0], 'bannerImage')} />
          </div>
        </div>

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          Aktiv
        </label>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.showInModal} onChange={(e) => setForm({ ...form, showInModal: e.target.checked })} />
            Im Modal anzeigen
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.showOnOffersPage} onChange={(e) => setForm({ ...form, showOnOffersPage: e.target.checked })} />
            Auf /angebote
          </label>
        </div>

        {analytics && (
          <div className="border rounded-lg p-4 bg-gray-50">
            <h3 className="font-semibold mb-3">Analytics</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div>Aufrufe: <strong>{analytics.viewCount}</strong></div>
              <div>Modal: <strong>{analytics.modalOpenCount}</strong></div>
              <div>Klicks: <strong>{analytics.clickCount}</strong></div>
              <div>Bestellungen: <strong>{analytics.orderCount}</strong></div>
              <div>Nutzungen: <strong>{analytics.usageCount}</strong></div>
              <div>Rabatt gesamt: <strong>{Number(analytics.revenueTotal).toFixed(2)} €</strong></div>
            </div>
          </div>
        )}

        <PromotionCampaignActions promotionId={id} />

        <button type="submit" disabled={submitting} className="flex items-center bg-primary-600 text-white px-6 py-2 rounded-md disabled:opacity-50">
          {submitting ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Save className="h-5 w-5 mr-2" />}
          Speichern
        </button>
      </form>
    </div>
  );
}
