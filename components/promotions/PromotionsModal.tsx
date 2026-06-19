"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { getActivePromotions, trackPromotionEvent } from '../../lib/api-client';
import { useCart } from '../../lib/contexts/CartContext';
import { SafeImage } from '../SafeImage';

function promoImageUrl(p: { bannerImage?: string; image?: string }): string | null {
  const src = p.bannerImage || p.image;
  if (!src) return null;
  return src;
}

function scheduleHint(p: {
  weekdayLabel?: string;
  scheduleLabel?: string;
  validTo?: string;
  weekdayScheduleEnabled?: boolean;
}): string {
  if (p.weekdayScheduleEnabled && p.weekdayLabel) {
    return `Jeden ${p.weekdayLabel}`;
  }
  if (p.scheduleLabel) {
    return p.scheduleLabel;
  }
  if (p.validTo) {
    return `bis ${new Date(p.validTo).toLocaleDateString('de-DE')}`;
  }
  return '';
}

// Показываем рекламную модалку один раз за ЗАГРУЗКУ страницы (refresh / первый заход).
// Флаг модульный — сбрасывается только при реальной перезагрузке, не при SPA-навигации,
// поэтому модалка НЕ всплывает повторно при выборе 2-й пиццы и переходах внутри сайта.
let promoModalShownThisLoad = false;

export default function PromotionsModal() {
  const pathname = usePathname();
  const { state } = useCart();
  const [open, setOpen] = useState(false);
  const [promotions, setPromotions] = useState<any[]>([]);

  // Идёт выбор акции: открыт/нужен BOGO-пикер или невыбранный подарок.
  const hasActiveOffer =
    (state.promotionCalculation?.bogoSecondOffers?.length ?? 0) > 0 ||
    (state.promotionCalculation?.freeGiftOffers || []).some(
      (o) => !state.selectedFreeGifts[o.promotionId]
    );

  useEffect(() => {
    if (promoModalShownThisLoad) return;
    if (pathname !== '/') return;
    if (hasActiveOffer) return; // не показываем рекламу поверх выбора акции
    promoModalShownThisLoad = true;
    getActivePromotions({ modal: true })
      .then((res) => {
        if (res.success && res.promotions?.length) {
          setPromotions(res.promotions);
          setOpen(true);
          res.promotions.forEach((p: { id: string }) => {
            trackPromotionEvent(p.id, 'modal_open').catch(() => {});
          });
        }
      })
      .catch(() => {});
  }, [pathname, hasActiveOffer]);

  // Если во время показа рекламы появился оффер (открылся пикер) — закрываем рекламу.
  useEffect(() => {
    if (hasActiveOffer && open) setOpen(false);
  }, [hasActiveOffer, open]);

  // Закрываем рекламу при любой навигации (напр. клик «Zum Angebot»);
  // флаг показа НЕ сбрасываем, поэтому повторно не откроется.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const close = () => {
    setOpen(false);
  };

  if (!open || promotions.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto relative">
        <button
          type="button"
          onClick={close}
          className="absolute top-3 right-3 p-2 rounded-full hover:bg-gray-100 z-10"
          aria-label="Schließen"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="p-6 pt-10">
          <h2 className="text-2xl font-bold text-center mb-6 text-primary-700">Aktuelle Angebote</h2>
          <div className="space-y-6">
            {promotions.map((p) => {
              const img = promoImageUrl(p);
              const hint = scheduleHint(p);
              return (
                <div key={p.id} className="border rounded-lg overflow-hidden">
                  {img && (
                    <div className="relative h-40 w-full bg-gray-100">
                      <SafeImage src={img} alt={p.name} className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="p-4">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="bg-primary-600 text-white text-xs font-bold px-2 py-1 rounded">
                        {p.badgeText || 'TOP DEAL'}
                      </span>
                      {hint && <span className="text-xs text-gray-500">{hint}</span>}
                    </div>
                    <h3 className="font-bold text-lg">{p.name}</h3>
                    {p.description && <p className="text-sm text-gray-600 mt-1">{p.description}</p>}
                    <Link
                      href={`/angebote/${p.slug}`}
                      onClick={() => trackPromotionEvent(p.id, 'click').catch(() => {})}
                      className="mt-4 inline-block w-full text-center bg-primary-600 text-white py-2 rounded-md hover:bg-primary-700"
                    >
                      Zum Angebot
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
          <Link
            href="/menu"
            onClick={close}
            className="mt-6 block w-full text-center border border-primary-600 text-primary-600 py-2 rounded-md hover:bg-primary-50"
          >
            Jetzt bestellen
          </Link>
        </div>
      </div>
    </div>
  );
}
