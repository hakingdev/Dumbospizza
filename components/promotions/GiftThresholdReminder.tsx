"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Gift, X } from 'lucide-react';
import { useCart } from '../../lib/contexts/CartContext';

/**
 * Напоминание: до бесплатного подарка (gratis при заказе от N €) осталось немного.
 * Показывается модалкой, когда клиент уже близко к порогу, по одному разу за «подход»
 * (повторно — только если он отдалился и снова приблизился). Не мешает выбору акций.
 */
export default function GiftThresholdReminder() {
  const pathname = usePathname();
  const { state } = useCart();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<{ giftName: string; remaining: number } | null>(null);
  const reminded = useRef<Set<string>>(new Set());

  const thresholds = state.promotionCalculation?.giftThresholds || [];
  const bogoOffers = state.promotionCalculation?.bogoSecondOffers || [];
  const giftOffers = state.promotionCalculation?.freeGiftOffers || [];
  const hasActiveOffer =
    bogoOffers.length > 0 ||
    giftOffers.some((o) => !state.selectedFreeGifts[o.promotionId]);

  // «Близко»: осталось > 0 и не больше окна (минимум 10 € или половина порога).
  const near = thresholds
    .filter((th) => th.remaining > 0 && th.remaining <= Math.max(10, th.threshold * 0.5))
    .sort((a, b) => a.remaining - b.remaining);

  useEffect(() => {
    // снимаем «показано» с акций, которые больше не близко (отдалился/получил подарок)
    const nearIds = new Set(near.map((n) => n.promotionId));
    for (const id of Array.from(reminded.current)) {
      if (!nearIds.has(id)) reminded.current.delete(id);
    }

    if (open) return;
    if (state.items.length === 0) return;
    if (hasActiveOffer) return; // не поверх выбора акции

    const target = near.find((n) => !reminded.current.has(n.promotionId));
    if (target) {
      reminded.current.add(target.promotionId);
      setActive({ giftName: target.giftName, remaining: target.remaining });
      setOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near.map((n) => `${n.promotionId}:${n.remaining}`).join('|'), hasActiveOffer, state.items.length, open]);

  if (!open || !active) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/50"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => setOpen(false)}
          className="absolute top-3 right-3 p-2 rounded-full hover:bg-gray-100"
          aria-label="Schließen"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="mx-auto w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
          <Gift className="h-7 w-7 text-emerald-600" />
        </div>
        <h2 className="text-xl font-bold mb-2">Fast geschafft! 🎁</h2>
        <p className="text-gray-600 mb-1">
          Nur noch{' '}
          <span className="font-bold text-emerald-700">{active.remaining.toFixed(2)} €</span>
        </p>
        <p className="text-gray-600 mb-6">
          und Sie erhalten <span className="font-semibold">{active.giftName}</span> gratis dazu.
        </p>
        <div className="flex flex-col gap-2">
          <Link
            href="/menu"
            onClick={() => setOpen(false)}
            className="w-full bg-primary-600 text-white py-2.5 rounded-lg hover:bg-primary-700 font-semibold"
          >
            Weiter bestellen
          </Link>
          <button
            onClick={() => setOpen(false)}
            className="w-full border border-gray-300 text-gray-600 py-2.5 rounded-lg hover:bg-gray-50"
          >
            Nein, danke
          </button>
        </div>
      </div>
    </div>
  );
}
