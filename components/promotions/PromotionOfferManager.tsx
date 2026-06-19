"use client";

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useCart } from '../../lib/contexts/CartContext';
import { useLanguage } from '../../lib/contexts/LanguageContext';
import { loadTranslation } from '../../lib/i18n';
import type { PromotionCalculationResult } from '../../lib/promotions/types';
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
  // Расчёт, по которому пользователь уже сделал выбор/отказ. До прихода СВЕЖЕГО
  // расчёта (новая ссылка из API) попап не переоткрываем — иначе после выбора
  // stale-оффер мгновенно открывает окно повторно (мигание).
  const handledCalc = useRef<PromotionCalculationResult | null>(null);

  useEffect(() => {
    loadTranslation(language).then(({ t: translation }) => setT(() => translation)).catch(() => {});
  }, [language]);

  const giftOffers = state.promotionCalculation?.freeGiftOffers || [];
  const bogoOffers = state.promotionCalculation?.bogoSecondOffers || [];

  const onCartPage = pathname?.startsWith('/cart') || pathname?.startsWith('/checkout');

  // При изменении состава корзины сбрасываем «обработанные/отклонённые» офферы —
  // это новое Angebot-событие, попап снова может предложить награду. Делаем сброс
  // в фазе рендера (до вычисления pendingBogo), чтобы изменение применилось сразу,
  // а не на следующий рендер (иначе после смены корзины попап не откроется).
  const cartSig = state.items
    .map((i) => `${i.productId || i.id}:${i.size?.name || ''}:${i.quantity}`)
    .join('|');
  if (cartSig !== lastCartSig.current) {
    lastCartSig.current = cartSig;
    dismissed.current.clear();
  }

  const pendingBogo = bogoOffers.filter((o) => !dismissed.current.has(o.promotionId));
  // оффер подарка присутствует, пока не выбран; dismissed — отказ
  const pendingGift = giftOffers.filter((o) => !dismissed.current.has(o.promotionId));

  useEffect(() => {
    if (onCartPage || open) return;
    // Уже обработали этот расчёт (выбор/отказ) — ждём свежий пересчёт корзины,
    // прежде чем снова предлагать оффер. Защита от повторного открытия попапа.
    if (state.promotionCalculation && state.promotionCalculation === handledCalc.current) return;
    if (pendingBogo.length > 0) setOpen('bogo');
    else if (pendingGift.length > 0) setOpen('gift');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCartPage, open, pendingBogo.length, pendingGift.length, state.promotionCalculation]);

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
          // Оффер обработан: не переоткрывать его авто-попапом до изменения корзины
          // (иначе при 2+ подходящих товарах движок снова вернёт оффер → дубль-модалка).
          bogoOffers.forEach((o) => dismissed.current.add(o.promotionId));
          handledCalc.current = state.promotionCalculation;
          setSlot({});
          setOpen(null);
        }}
        onClose={() => {
          bogoOffers.forEach((o) => dismissed.current.add(o.promotionId));
          handledCalc.current = state.promotionCalculation;
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
          giftOffers.forEach((o) => dismissed.current.add(o.promotionId));
          handledCalc.current = state.promotionCalculation;
          setGiftSlot({});
          setOpen(null);
        }}
        onClose={() => {
          giftOffers.forEach((o) => dismissed.current.add(o.promotionId));
          handledCalc.current = state.promotionCalculation;
          setGiftSlot({});
          setOpen(null);
        }}
        t={t}
      />
    );
  }

  return null;
}
