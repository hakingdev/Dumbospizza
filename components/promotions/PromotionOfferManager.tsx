"use client";

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useCart } from '../../lib/contexts/CartContext';
import { useLanguage } from '../../lib/contexts/LanguageContext';
import { loadTranslation } from '../../lib/i18n';
import BogoHalfPricePickerModal from './BogoHalfPricePickerModal';
import GratisGiftPickerModal from './GratisGiftPickerModal';

/**
 * Глобальный авто-показ предложений акций (Lieferando):
 * как только в корзине появляется незаполненный слот BOGO (одна награда за пару)
 * или подарок — всплывает окно выбора. Каждая выбранная награда добавляется
 * отдельной позицией; при добавлении новой пары попап предлагает следующую.
 * На /cart и /checkout не вмешиваемся.
 */
export default function PromotionOfferManager() {
  const pathname = usePathname();
  const { state, setSelectedFreeGift, setSelectedBogoSecond } = useCart();
  const { language } = useLanguage();
  const [t, setT] = useState<any>(() => (k: string, fb?: string) => fb || k);
  const [open, setOpen] = useState<'bogo' | 'gift' | null>(null);
  // временный выбор для текущего попапа (одна награда за раз)
  const [slot, setSlot] = useState<Record<string, string>>({});
  const [giftSlot, setGiftSlot] = useState<Record<string, string>>({});
  const dismissed = useRef<Set<string>>(new Set());
  const lastCartSig = useRef<string>('');

  useEffect(() => {
    loadTranslation(language).then(({ t: translation }) => setT(() => translation)).catch(() => {});
  }, [language]);

  const giftOffers = state.promotionCalculation?.freeGiftOffers || [];
  const bogoOffers = state.promotionCalculation?.bogoSecondOffers || [];

  const onCartPage = pathname?.startsWith('/cart') || pathname?.startsWith('/checkout');

  // при изменении состава корзины снимаем «Nein danke» — новая пара снова предлагает награду
  const cartSig = state.items
    .map((i) => `${i.productId || i.id}:${i.size?.name || ''}:${i.quantity}`)
    .join('|');
  useEffect(() => {
    if (cartSig !== lastCartSig.current) {
      lastCartSig.current = cartSig;
      dismissed.current.clear();
    }
  }, [cartSig]);

  const pendingBogo = bogoOffers.filter((o) => !dismissed.current.has(o.promotionId));
  // оффер подарка присутствует, пока не выбран; dismissed — отказ
  const pendingGift = giftOffers.filter((o) => !dismissed.current.has(o.promotionId));

  useEffect(() => {
    if (onCartPage || open) return;
    if (pendingBogo.length > 0) setOpen('bogo');
    else if (pendingGift.length > 0) setOpen('gift');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCartPage, open, pendingBogo.length, pendingGift.length]);

  if (onCartPage || !open) return null;

  if (open === 'bogo' && bogoOffers.length > 0) {
    return (
      <BogoHalfPricePickerModal
        offers={bogoOffers}
        selections={slot}
        onSelect={(promotionId, optionId) => setSlot((s) => ({ ...s, [promotionId]: optionId }))}
        onConfirm={() => {
          // добавляем выбранную награду (по одной за пару)
          for (const [pid, oid] of Object.entries(slot)) {
            if (oid) setSelectedBogoSecond(pid, oid);
          }
          setSlot({});
          setOpen(null);
        }}
        onClose={() => {
          bogoOffers.forEach((o) => dismissed.current.add(o.promotionId));
          setSlot({});
          setOpen(null);
        }}
        t={t}
      />
    );
  }

  if (open === 'gift' && giftOffers.length > 0) {
    return (
      <GratisGiftPickerModal
        offers={giftOffers}
        selections={giftSlot}
        onSelect={(promotionId, optionId) => setGiftSlot((s) => ({ ...s, [promotionId]: optionId }))}
        onConfirm={() => {
          for (const [pid, oid] of Object.entries(giftSlot)) {
            if (oid) setSelectedFreeGift(pid, oid);
          }
          setGiftSlot({});
          setOpen(null);
        }}
        onClose={() => {
          giftOffers.forEach((o) => dismissed.current.add(o.promotionId));
          setGiftSlot({});
          setOpen(null);
        }}
        t={t}
      />
    );
  }

  return null;
}
