"use client";

import React, { createContext, useContext, useReducer, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { PromotionCalculationResult } from '../promotions/types';
import { calculatePromotions as fetchPromotionCalculation } from '../api-client';
import { normalizeObjectId } from '../normalize-id';
import { storageGet, storageSet } from '../safe-storage';
import { getAppliedPromotionDiscount, getBogoPickerMerchandise } from '../promotions/discount-total';
import { giftOptionId } from '../promotions/gifts';
import { trackMetaEvent } from '../analytics/meta-pixel';

// Types
export interface CartItem {
  id: string;
  productId?: string;
  name: string;
  quantity: number;
  price: number;
  basePrice: number;
  size?: {
    id: string;
    variationId?: string;
    name: string;
    label?: string;
    price?: number;
    // legacy
    size?: string;
    priceModifier?: number;
  };
  extras?: {
    toppings?: Array<{ id?: string; name: string; price: number }>;
    sauces?: Array<{ id?: string; name: string; price: number }>;
    sides?: Array<{ id?: string; name: string; price: number }>;
  };
  /** выбранные опции из переиспользуемых групп (Optionsgruppen) */
  options?: Array<{ groupId?: string; group: string; name: string; price: number }>;
  image?: string;
  notes?: string;
  categoryId?: string;
}

export interface CartState {
  items: CartItem[];
  subtotal: number;
  tax: number;
  deliveryFee: number;
  total: number;
  deliveryType: 'delivery' | 'pickup';
  deliveryZone: string | null;
  minOrderAmount: number;
  loyaltyPointsToRedeem: number;
  loyaltyPointsDiscount: number;
  couponCode?: string;
  couponDiscount: number;
  /**
   * Доступна ли денежная акция (percent/fixed/bogo) для текущей корзины.
   * Когда активен купон, денежные акции подавляются, но этот флаг остаётся true —
   * по нему показываем пользователю выбор «оставить купон или применить акцию».
   */
  moneyPromotionAvailable: boolean;
  promotionPromoCode?: string;
  promotionCalculation: PromotionCalculationResult | null;
  /** promotionId → productId для Gratis-Auswahl (1 aus N) */
  selectedFreeGifts: Record<string, string>;
  /** promotionId → true, wenn Kunde den optionalen Gratis-Artikel abgelehnt hat */
  declinedFreeGifts: Record<string, boolean>;
  /**
   * promotionId → выбранные BOGO-награды. Каждая награда привязана к КОНКРЕТНОЙ
   * квалифицирующей строке корзины (`itemId` = CartItem.id той пиццы, после которой
   * выпало Angebot). Удаление этой пиццы убирает именно её награду, а не «случайную».
   * `productId` — id выбранной опции награды (option.id). itemId='' = не привязана
   * (легаси/корзина из localStorage старого формата).
   */
  selectedBogoSecond: Record<string, Array<{ itemId: string; productId: string }>>;
  contactInfo: {
    name: string;
    phoneNumber: string;
    email?: string;
  };
  deliveryAddress?: {
    street: string;
    houseNumber: string;
    postalCode: string;
    city: string;
    floor?: string;
    notes?: string;
  };
  // 'paypal'/'sepa' — клиентские значения выбора на чекауте; в БД такой заказ
  // сохраняется как 'online' (провайдер живёт в таблице payments).
  paymentMethod?: 'cash' | 'card' | 'online' | 'paypal' | 'sepa';
}

type CartAction =
  | { type: 'ADD_ITEM'; payload: CartItem }
  | { type: 'UPDATE_ITEM'; payload: { id: string; updates: Partial<CartItem> } }
  | { type: 'REMOVE_ITEM'; payload: string }
  | { type: 'CLEAR_CART' }
  | { type: 'SET_DELIVERY_TYPE'; payload: 'delivery' | 'pickup' }
  | { type: 'SET_DELIVERY_ZONE'; payload: { zone: string; minOrderAmount: number } }
  | { type: 'SET_DELIVERY_FEE'; payload: number }
  | { type: 'SET_CONTACT_INFO'; payload: Partial<CartState['contactInfo']> }
  | { type: 'SET_DELIVERY_ADDRESS'; payload: Partial<CartState['deliveryAddress']> }
  | { type: 'SET_PAYMENT_METHOD'; payload: CartState['paymentMethod'] }
  | { type: 'SET_LOYALTY_POINTS'; payload: number }
  | { type: 'APPLY_COUPON'; payload: { code: string; discount: number } }
  | { type: 'REMOVE_COUPON' }
  | { type: 'SET_PROMOTION_CALCULATION'; payload: PromotionCalculationResult | null }
  | { type: 'SET_MONEY_PROMOTION_AVAILABLE'; payload: boolean }
  | { type: 'SET_PROMOTION_PROMO_CODE'; payload: string | undefined }
  | { type: 'SET_SELECTED_FREE_GIFT'; payload: { promotionId: string; productId: string } }
  | { type: 'SET_DECLINED_FREE_GIFT'; payload: { promotionId: string } }
  | { type: 'CLEAR_SELECTED_FREE_GIFTS' }
  | { type: 'SET_SELECTED_BOGO_SECOND'; payload: { promotionId: string; productId: string } }
  | { type: 'SYNC_TOTALS'; payload: Partial<CartState> }
  | { type: 'RESET_CHECKOUT_DATA' };

const initialState: CartState = {
  items: [],
  subtotal: 0,
  tax: 0,
  deliveryFee: 0,
  total: 0,
  deliveryType: 'delivery',
  deliveryZone: null,
  minOrderAmount: 0,
  loyaltyPointsToRedeem: 0,
  loyaltyPointsDiscount: 0,
  couponDiscount: 0,
  moneyPromotionAvailable: false,
  promotionCalculation: null,
  selectedFreeGifts: {},
  declinedFreeGifts: {},
  selectedBogoSecond: {},
  contactInfo: {
    name: '',
    phoneNumber: '',
  },
};

// Helper function to calculate cart totals
const calculateTotals = (state: CartState): Partial<CartState> => {
  const subtotal = state.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  const tax = 0;

  const loyaltyPointsDiscount = state.loyaltyPointsToRedeem * 1; // 1 балл = 1 € (pointValueEuro)
  const couponDiscount = state.couponDiscount || 0;
  // Купон и денежная акция не комбинируются: при активном купоне денежные акции
  // (включая BOGO-награду) не учитываем в total — Gratis-Artikel не даёт скидки и так.
  // (Серверный расчёт уже подавляет их; это убирает мгновенный двойной вычет в UI
  //  до возврата пересчёта.)
  const couponActive = !!state.couponCode;
  const bogoSecondTotal = couponActive ? 0 : getBogoPickerMerchandise(state.promotionCalculation);
  const promotionDiscount = couponActive ? 0 : getAppliedPromotionDiscount(state.promotionCalculation);

  // Free delivery for orders >= 30 euros
  const FREE_DELIVERY_THRESHOLD = 30;
  const merchandiseForDelivery = subtotal + bogoSecondTotal;
  const effectiveDeliveryFee =
    state.deliveryType === 'delivery' && merchandiseForDelivery >= FREE_DELIVERY_THRESHOLD
      ? 0
      : state.deliveryType === 'pickup'
        ? 0
        : state.deliveryFee;

  const total = Math.max(
    subtotal +
      bogoSecondTotal +
      effectiveDeliveryFee -
      loyaltyPointsDiscount -
      couponDiscount -
      promotionDiscount,
    0
  );
  
  return {
    subtotal,
    tax,
    loyaltyPointsDiscount,
    deliveryFee: effectiveDeliveryFee,
    total,
  };
};

/**
 * Сравнивает два «record»-выбора (значения — строка/булево или массив строк).
 * Нужен, чтобы SET_PROMOTION_CALCULATION НЕ создавал новую ссылку выбора при
 * неизменном содержимом. Иначе ссылки selectedBogoSecond/selectedFreeGifts/
 * declinedFreeGifts меняются на КАЖДЫЙ пересчёт → deps `recalculatePromotions`
 * меняются → бесконечный цикл пересчёта (постоянный polling API) и «мигание»
 * попапа акции на ~1 с сразу после выбора награды (устаревший запрос ещё в пути).
 */
function recordsEqual(
  a: Record<string, string | boolean | string[]>,
  b: Record<string, string | boolean | string[]>
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    const av = a[k];
    const bv = b[k];
    if (Array.isArray(av) || Array.isArray(bv)) {
      if (!Array.isArray(av) || !Array.isArray(bv) || av.length !== bv.length) return false;
      for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return false;
    } else if (av !== bv) {
      return false;
    }
  }
  return true;
}

type BogoSelection = { itemId: string; productId: string };

/**
 * Контентное сравнение selectedBogoSecond (с привязкой itemId), чтобы
 * SET_PROMOTION_CALCULATION не создавал новую ссылку при неизменном выборе и не
 * зацикливал пересчёт (deps recalculatePromotions). Аналог recordsEqual для нового
 * формата (массивы объектов {itemId, productId}).
 */
function bogoSelectionsEqual(
  a: Record<string, BogoSelection[]>,
  b: Record<string, BogoSelection[]>
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const k of aKeys) {
    const av = a[k];
    const bv = b[k];
    if (!bv || av.length !== bv.length) return false;
    for (let i = 0; i < av.length; i++) {
      if (av[i].itemId !== bv[i].itemId || av[i].productId !== bv[i].productId) return false;
    }
  }
  return true;
}

/**
 * Какую квалифицирующую строку корзины привязать к новой BOGO-награде: САМУЮ ПОЗДНЮЮ
 * (последнюю добавленную) подходящую пиццу, у которой ещё есть свободный слот
 * (привязанных наград < quantity). Это и есть «та пицца, после которой выпало
 * Angebot». Если квалифицирующие строки неизвестны (нет оффера в расчёте) — '' (без
 * привязки), движок всё равно ограничит число наград.
 */
function findBogoQualifyingItemId(state: CartState, promotionId: string): string {
  const offer = state.promotionCalculation?.bogoSecondOffers?.find(
    (o) => o.promotionId === promotionId
  );
  const qualifying = offer?.qualifyingItems || [];
  if (qualifying.length === 0) return '';
  const matches = (item: CartItem) =>
    qualifying.some((q) => {
      if (String(q.productId) !== String(item.productId || item.id)) return false;
      const qSize = (q.sizeName || '').trim();
      return qSize === '' || qSize === (item.size?.name || '');
    });
  const prev = state.selectedBogoSecond[promotionId] || [];
  const boundCount = (id: string) => prev.filter((s) => s.itemId === id).length;
  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i];
    if (!matches(item)) continue;
    if (boundCount(item.id) < item.quantity) return item.id;
  }
  return '';
}

/** Убрать BOGO-награды, привязанные к удалённой строке корзины (по itemId). */
function dropBogoSelectionsForItem(
  selected: Record<string, BogoSelection[]>,
  itemId: string
): Record<string, BogoSelection[]> {
  let changed = false;
  const next: Record<string, BogoSelection[]> = {};
  for (const [promo, sels] of Object.entries(selected)) {
    const kept = sels.filter((s) => s.itemId !== itemId);
    if (kept.length !== sels.length) changed = true;
    if (kept.length > 0) next[promo] = kept;
  }
  return changed ? next : selected;
}

/**
 * При уменьшении количества строки — обрезать её BOGO-награды до нового числа слотов
 * (лишние, привязанные к исчезнувшим единицам, убираем).
 */
function trimBogoSelectionsForItem(
  selected: Record<string, BogoSelection[]>,
  itemId: string,
  maxForItem: number
): Record<string, BogoSelection[]> {
  let changed = false;
  const next: Record<string, BogoSelection[]> = {};
  for (const [promo, sels] of Object.entries(selected)) {
    let count = 0;
    const kept = sels.filter((s) => {
      if (s.itemId !== itemId) return true;
      if (count < maxForItem) {
        count++;
        return true;
      }
      changed = true;
      return false;
    });
    if (kept.length > 0) next[promo] = kept;
  }
  return changed ? next : selected;
}

// Cart reducer
export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'ADD_ITEM': {
      // Check if item already exists with the same customizations
      const existingItemIndex = state.items.findIndex(item => {
        if (item.id !== action.payload.id) return false;
        
        // Check if sizes match
        if (
          (item.size?.id !== action.payload.size?.id) ||
          (!item.size && action.payload.size) ||
          (item.size && !action.payload.size)
        ) {
          return false;
        }
        
        // Check if extras match (simplified check)
        const extrasMatch = JSON.stringify(item.extras) === JSON.stringify(action.payload.extras);
        return extrasMatch;
      });
      
      let newItems;
      
      if (existingItemIndex >= 0) {
        // Update existing item quantity
        newItems = [...state.items];
        newItems[existingItemIndex] = {
          ...newItems[existingItemIndex],
          quantity: newItems[existingItemIndex].quantity + action.payload.quantity,
        };
      } else {
        // Add new item
        newItems = [...state.items, action.payload];
      }
      
      const newState = { ...state, items: newItems, declinedFreeGifts: {} };
      return {
        ...newState,
        ...calculateTotals(newState),
      };
    }
    
    case 'UPDATE_ITEM': {
      const newItems = state.items.map(item =>
        item.id === action.payload.id ? { ...item, ...action.payload.updates } : item
      );

      // При уменьшении количества обрезаем «лишние» BOGO-награды этой строки, чтобы
      // они не висели за исчезнувшие единицы.
      const newQty = action.payload.updates.quantity;
      const selectedBogoSecond =
        typeof newQty === 'number'
          ? trimBogoSelectionsForItem(state.selectedBogoSecond, action.payload.id, newQty)
          : state.selectedBogoSecond;

      const newState = { ...state, items: newItems, selectedBogoSecond, declinedFreeGifts: {} };
      return {
        ...newState,
        ...calculateTotals(newState),
      };
    }

    case 'REMOVE_ITEM': {
      const newItems = state.items.filter(item => item.id !== action.payload);
      // Удаляем BOGO-награды, привязанные к удалённой пицце — а не «случайную»
      // (раньше движок при сжатии слотов отбрасывал последнюю по порядку награду,
      // т.е. награду ОСТАВШЕЙСЯ пиццы).
      const selectedBogoSecond = dropBogoSelectionsForItem(
        state.selectedBogoSecond,
        action.payload
      );
      const newState = { ...state, items: newItems, selectedBogoSecond, declinedFreeGifts: {} };
      return {
        ...newState,
        ...calculateTotals(newState),
      };
    }

    case 'CLEAR_CART':
      return {
        ...initialState,
        contactInfo: state.contactInfo, // Preserve contact info
        deliveryAddress: state.deliveryAddress, // Preserve delivery address
      };
    
    case 'SET_DELIVERY_TYPE':
      return {
        ...state,
        deliveryType: action.payload,
        // Reset delivery fee if switching to pickup
        deliveryFee: action.payload === 'pickup' ? 0 : state.deliveryFee,
        // Recalculate totals
        ...calculateTotals({
          ...state,
          deliveryFee: action.payload === 'pickup' ? 0 : state.deliveryFee,
        }),
      };
    
    case 'SET_DELIVERY_ZONE':
      return {
        ...state,
        deliveryZone: action.payload.zone,
        minOrderAmount: action.payload.minOrderAmount,
      };
    
    case 'SET_DELIVERY_FEE':
      return {
        ...state,
        deliveryFee: action.payload,
        ...calculateTotals({
          ...state,
          deliveryFee: action.payload,
        }),
      };
    
    case 'SET_CONTACT_INFO':
      return {
        ...state,
        contactInfo: {
          ...state.contactInfo,
          ...action.payload,
        },
      };
    
    case 'SET_DELIVERY_ADDRESS':
      return {
        ...state,
        deliveryAddress: {
          ...state.deliveryAddress,
          ...action.payload,
        },
      };
    
    case 'SET_PAYMENT_METHOD':
      return {
        ...state,
        paymentMethod: action.payload,
      };
    
    case 'SET_LOYALTY_POINTS': {
      const newState = {
        ...state,
        loyaltyPointsToRedeem: action.payload,
      };
      return {
        ...newState,
        ...calculateTotals(newState),
      };
    }
    
    case 'APPLY_COUPON': {
      const newState = {
        ...state,
        couponCode: action.payload.code,
        couponDiscount: action.payload.discount,
      };
      return {
        ...newState,
        ...calculateTotals(newState),
      };
    }
    
    case 'REMOVE_COUPON': {
      // Удаление промокода/купона: чистим И coupon, И promotion-code, чтобы
      // recalculatePromotions ушёл с couponActive:false и promoCode:undefined,
      // и автоматические Angebote вернулись (источник истины — новый расчёт).
      // selectedFreeGifts / selectedBogoSecond НЕ трогаем — выбор пользователя
      // восстановится, если он ещё валиден в новой калькуляции.
      const newState = {
        ...state,
        couponCode: undefined,
        couponDiscount: 0,
        promotionPromoCode: undefined,
      };
      return {
        ...newState,
        ...calculateTotals(newState),
      };
    }

    case 'SET_PROMOTION_CALCULATION': {
      const payload = action.payload;
      let selectedFreeGifts: Record<string, string> = {};
      let declinedFreeGifts: Record<string, boolean> = {};
      let selectedBogoSecond: Record<string, BogoSelection[]> = {};
      if (payload) {
        // Ключ выбранного подарка — id опции (productId|sizeName), чтобы различать размеры.
        const fromResolvedGifts = Object.fromEntries(
          (payload.freeGifts || []).map((gift) => [
            gift.promotionId,
            giftOptionId(gift.productId, gift.sizeName),
          ])
        );
        if (payload.freeGiftOffers?.length) {
          const validOffers = new Set(payload.freeGiftOffers.map((o) => o.promotionId));
          const pendingSelections = Object.fromEntries(
            Object.entries(state.selectedFreeGifts).filter(([promotionId, selectedKey]) => {
              if (!validOffers.has(promotionId)) return false;
              const offer = payload.freeGiftOffers!.find((o) => o.promotionId === promotionId);
              return offer?.options.some((o) => o.id === selectedKey) ?? false;
            })
          );
          selectedFreeGifts = { ...fromResolvedGifts, ...pendingSelections };
          declinedFreeGifts = Object.fromEntries(
            Object.entries(state.declinedFreeGifts || {}).filter(
              ([promotionId, declined]) =>
                declined && validOffers.has(promotionId) && !selectedFreeGifts[promotionId]
            )
          );
        } else {
          selectedFreeGifts = fromResolvedGifts;
        }

        if (state.couponCode) {
          // Купон подавляет денежные акции (BOGO) → bogoSecondItems приходит пустым.
          // НЕ затираем выбор второго товара (вместе с привязкой к пицце), чтобы он
          // вернулся после удаления купона.
          selectedBogoSecond = state.selectedBogoSecond;
        } else {
          // Сверяем выбор клиента с движком (источник истины), СОХРАНЯЯ привязку каждой
          // награды к конкретной пицце (itemId). Идём по существующим выборам в их
          // порядке: принятые движком (есть в bogoSecondItems) и валидные ещё открытые
          // (есть в опциях оффера) — оставляем с их itemId; остальные отбрасываем.
          const grouped: Record<string, BogoSelection[]> = {};

          // Принятые движком награды по акции (option.id, с учётом quantity-агрегации).
          const acceptedByPromo: Record<string, string[]> = {};
          for (const item of payload.bogoSecondItems || []) {
            const key = item.id || item.productId;
            const list = (acceptedByPromo[item.promotionId] =
              acceptedByPromo[item.promotionId] || []);
            for (let i = 0; i < (item.quantity || 1); i++) list.push(key);
          }
          // Валидные опции открытых офферов (ещё не заполненные слоты).
          const validByPromo: Record<string, Set<string>> = {};
          for (const offer of payload.bogoSecondOffers || []) {
            validByPromo[offer.promotionId] = new Set(offer.options.map((o) => o.id));
          }

          const promoIds = Array.from(
            new Set<string>([
              ...Object.keys(state.selectedBogoSecond),
              ...Object.keys(acceptedByPromo),
            ])
          );
          for (const promo of promoIds) {
            const prev = state.selectedBogoSecond[promo] || [];
            const accepted = [...(acceptedByPromo[promo] || [])];
            const valid = validByPromo[promo];
            const kept: BogoSelection[] = [];
            for (const sel of prev) {
              const ai = accepted.indexOf(sel.productId);
              if (ai >= 0) {
                // Награда принята движком — сохраняем вместе с привязкой к пицце.
                accepted.splice(ai, 1);
                kept.push(sel);
              } else if (valid && valid.has(sel.productId)) {
                // Ещё не отражена, но валидна и оффер открыт — сохраняем (с привязкой).
                kept.push(sel);
              }
              // иначе: невалидна / лимит слотов исчерпан → отбрасываем.
            }
            // Принятые движком награды без соответствующего выбора (страховка от потери
            // выбора, напр. после миграции localStorage) — добавляем без привязки.
            for (const leftover of accepted) {
              kept.push({ itemId: '', productId: leftover });
            }
            if (kept.length > 0) grouped[promo] = kept;
          }
          selectedBogoSecond = grouped;
        }
      }
      // Сохраняем ПРЕЖНИЕ ссылки выбора при неизменном содержимом, чтобы не
      // зацикливать пересчёт (deps recalculatePromotions) и не плодить
      // устаревшие запросы, из-за которых попап акции мигал после выбора.
      const prevDeclined = state.declinedFreeGifts || {};
      const newState = {
        ...state,
        promotionCalculation: payload,
        selectedFreeGifts: recordsEqual(state.selectedFreeGifts, selectedFreeGifts)
          ? state.selectedFreeGifts
          : selectedFreeGifts,
        declinedFreeGifts: recordsEqual(prevDeclined, declinedFreeGifts)
          ? prevDeclined
          : declinedFreeGifts,
        selectedBogoSecond: bogoSelectionsEqual(state.selectedBogoSecond, selectedBogoSecond)
          ? state.selectedBogoSecond
          : selectedBogoSecond,
      };
      return { ...newState, ...calculateTotals(newState) };
    }

    case 'SET_MONEY_PROMOTION_AVAILABLE':
      if (state.moneyPromotionAvailable === action.payload) return state;
      return { ...state, moneyPromotionAvailable: action.payload };

    case 'SET_SELECTED_FREE_GIFT': {
      const declinedFreeGifts = { ...(state.declinedFreeGifts || {}) };
      delete declinedFreeGifts[action.payload.promotionId];
      const newState = {
        ...state,
        selectedFreeGifts: {
          ...state.selectedFreeGifts,
          [action.payload.promotionId]: action.payload.productId,
        },
        declinedFreeGifts,
      };
      return newState;
    }

    case 'SET_DECLINED_FREE_GIFT': {
      const selectedFreeGifts = { ...state.selectedFreeGifts };
      delete selectedFreeGifts[action.payload.promotionId];
      return {
        ...state,
        selectedFreeGifts,
        declinedFreeGifts: {
          ...(state.declinedFreeGifts || {}),
          [action.payload.promotionId]: true,
        },
      };
    }

    case 'CLEAR_SELECTED_FREE_GIFTS':
      return { ...state, selectedFreeGifts: {} };

    case 'SET_SELECTED_BOGO_SECOND': {
      // Добавляем ещё одну награду к акции (несколько за несколько пар) и привязываем
      // её к конкретной квалифицирующей пицце (той, после которой выпал оффер), чтобы
      // удаление этой пиццы убирало именно её награду.
      const prev = state.selectedBogoSecond[action.payload.promotionId] || [];
      const itemId = findBogoQualifyingItemId(state, action.payload.promotionId);
      const newState = {
        ...state,
        selectedBogoSecond: {
          ...state.selectedBogoSecond,
          [action.payload.promotionId]: [
            ...prev,
            { itemId, productId: action.payload.productId },
          ],
        },
      };
      return newState;
    }

    case 'SET_PROMOTION_PROMO_CODE': {
      const newState = { ...state, promotionPromoCode: action.payload };
      return { ...newState, ...calculateTotals(newState) };
    }
    
    case 'RESET_CHECKOUT_DATA': {
      const newState: CartState = {
        ...state,
        deliveryType: 'delivery',
        deliveryZone: null,
        minOrderAmount: 0,
        deliveryFee: 0,
        loyaltyPointsToRedeem: 0,
        loyaltyPointsDiscount: 0,
        couponCode: undefined,
        couponDiscount: 0,
        promotionPromoCode: undefined,
        promotionCalculation: null,
        selectedFreeGifts: {},
        declinedFreeGifts: {},
        selectedBogoSecond: {},
        paymentMethod: undefined,
      };
      return { ...newState, ...calculateTotals(newState) };
    }

    case 'SYNC_TOTALS':
      return { ...state, ...action.payload };
    
    default:
      return state;
  }
}

// Create context
export type CartTotals = ReturnType<typeof calculateTotals>;

interface CartContextType {
  state: CartState;
  totals: CartTotals;
  dispatch: React.Dispatch<CartAction>;
  addItem: (item: CartItem) => void;
  updateItem: (id: string, updates: Partial<CartItem>) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
  setDeliveryType: (type: 'delivery' | 'pickup') => void;
  setDeliveryZone: (zone: string, minOrderAmount: number) => void;
  setDeliveryFee: (fee: number) => void;
  setContactInfo: (info: Partial<CartState['contactInfo']>) => void;
  setDeliveryAddress: (address: Partial<CartState['deliveryAddress']>) => void;
  setPaymentMethod: (method: CartState['paymentMethod']) => void;
  setLoyaltyPoints: (points: number) => void;
  applyCoupon: (code: string, discount: number) => void;
  removeCoupon: () => void;
  setPromotionPromoCode: (code: string | undefined) => void;
  setSelectedFreeGift: (promotionId: string, productId: string) => void;
  declineFreeGift: (promotionId: string) => void;
  setSelectedBogoSecond: (promotionId: string, productId: string) => void;
  resetCheckoutData: () => void;
  cartItemsCount: number;
  canProceedToCheckout: boolean;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

// Provider component
export function CartProvider({ children }: { children: React.ReactNode }) {
  // Try to load cart state from localStorage on initial render
  const [state, dispatch] = useReducer(cartReducer, initialState, () => {
    if (typeof window !== 'undefined') {
      try {
        const savedCart = storageGet('pizza-cart');
        if (savedCart) {
          const parsed = JSON.parse(savedCart);
          const loaded = {
            ...initialState,
            ...parsed,
            selectedFreeGifts: parsed.selectedFreeGifts || {},
            declinedFreeGifts: parsed.declinedFreeGifts || {},
            // нормализуем к массивам объектов {itemId, productId}. Старые форматы:
            // строка, массив строк, либо уже объекты — мигрируем без привязки (itemId='').
            selectedBogoSecond: Object.fromEntries(
              Object.entries(parsed.selectedBogoSecond || {}).map(([k, v]) => [
                k,
                (Array.isArray(v) ? v : v ? [v] : []).map((entry: any) =>
                  typeof entry === 'string'
                    ? { itemId: '', productId: entry }
                    : { itemId: entry?.itemId || '', productId: entry?.productId }
                ),
              ])
            ),
            // Altlast: Positionen der entfernten Matchday-Kombi (Pizzen/Gratis-Getränke
            // und vor allem die −5 €-Rabattzeile) aus gespeicherten Warenkörben werfen,
            // sonst behält ein alter Warenkorb den Rabatt ohne die Kombi.
            items: Array.isArray(parsed.items)
              ? parsed.items
                  .filter((item: CartItem & { comboId?: string }) => !item.comboId)
                  .map((item: CartItem) => ({
                    ...item,
                    categoryId: normalizeObjectId(item.categoryId),
                  }))
              : [],
          };
          return { ...loaded, ...calculateTotals(loaded) };
        }
      } catch (error) {
        console.error('Error loading cart from localStorage:', error);
      }
    }
    return initialState;
  });
  
  const router = useRouter();

  // Monoton steigende Sequenz, um veraltete Promotion-Antworten zu verwerfen.
  const recalcSeqRef = useRef(0);

  // Save cart to localStorage when it changes.
  // Чтение уже было в try/catch, а запись — нет. Между тем именно setItem бросает
  // QuotaExceededError (приватный режим / переполненная квота на iOS) и
  // SecurityError (включена блокировка всех cookies). CartProvider оборачивает всё
  // приложение, так что бросок отсюда ронял КАЖДУЮ страницу. storageSet при
  // недоступном storage просто вернёт false — корзина живёт в памяти до перезагрузки.
  useEffect(() => {
    storageSet('pizza-cart', JSON.stringify(state));
  }, [state]);

  const recalculatePromotions = useCallback(async () => {
    // Veraltete/out-of-order Antworten dürfen frische Daten NICHT überschreiben.
    // (Sonst kann eine langsame/fehlgeschlagene Neuberechnung eine bereits gewählte
    //  Belohnung — z. B. die 2. Gratis-Pizza — wieder aus dem Warenkorb entfernen.)
    const seq = ++recalcSeqRef.current;
    const isStale = () => seq !== recalcSeqRef.current;

    if (state.items.length === 0) {
      dispatch({ type: 'SET_PROMOTION_CALCULATION', payload: null });
      return;
    }
    try {
      const items = state.items.map((item) => ({
        productId: item.productId || item.id,
        categoryId: normalizeObjectId(item.categoryId),
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.price,
        sizeName: item.size?.name || '',
      }));
      const phone = state.contactInfo.phoneNumber?.trim();
      const res = await fetchPromotionCalculation(items, 'web', state.promotionPromoCode, phone || undefined, {
        selectedBogoSecond: Object.entries(state.selectedBogoSecond).flatMap(
          ([promotionId, sels]) => (sels || []).map((s) => ({ promotionId, productId: s.productId }))
        ),
        selectedFreeGifts: Object.entries(state.selectedFreeGifts).map(
          ([promotionId, productId]) => ({ promotionId, productId })
        ),
        // Купон активен → денежные акции подавляются (несовместимы с купоном).
        couponActive: !!state.couponCode,
      });
      // Inzwischen wurde eine neuere Neuberechnung gestartet → dieses Ergebnis verwerfen.
      if (isStale()) return;
      if (res.success) {
        dispatch({ type: 'SET_PROMOTION_CALCULATION', payload: res.calculation });
        dispatch({
          type: 'SET_MONEY_PROMOTION_AVAILABLE',
          payload: res.moneyPromotionAvailable === true,
        });
      }
    } catch (e) {
      console.error('Promotion calculation failed:', e);
    }
  }, [
    state.items,
    state.promotionPromoCode,
    state.contactInfo.phoneNumber,
    state.selectedBogoSecond,
    state.selectedFreeGifts,
    state.couponCode,
  ]);

  useEffect(() => {
    const timer = setTimeout(recalculatePromotions, 350);
    return () => clearTimeout(timer);
  }, [recalculatePromotions]);

  const totals = useMemo(
    () => calculateTotals(state),
    [state]
  );

  useEffect(() => {
    if (
      Math.abs((totals.total ?? 0) - state.total) > 0.001 ||
      Math.abs((totals.subtotal ?? 0) - state.subtotal) > 0.001 ||
      (totals.deliveryFee ?? 0) !== state.deliveryFee
    ) {
      dispatch({ type: 'SYNC_TOTALS', payload: totals });
    }
  }, [totals, state.total, state.subtotal, state.deliveryFee]);
  
  // Cart utility functions.
  // Все обёртки над dispatch — в useCallback со стабильной идентичностью:
  // они попадают в зависимости эффектов у потребителей (например, страница
  // подтверждения заказа), и нестабильная идентичность зацикливала эффекты.
  const addItem = useCallback((item: CartItem) => {
    dispatch({ type: 'ADD_ITEM', payload: item });
    // Meta Pixel: добавление в корзину (центральная точка — покрывает все пути добавления)
    trackMetaEvent('AddToCart', {
      content_ids: [item.productId || item.id],
      content_type: 'product',
      content_name: item.name,
      value: item.price * item.quantity,
      currency: 'EUR',
    });
  }, []);

  const updateItem = useCallback((id: string, updates: Partial<CartItem>) => {
    dispatch({ type: 'UPDATE_ITEM', payload: { id, updates } });
  }, []);

  const removeItem = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_ITEM', payload: id });
  }, []);

  const clearCart = useCallback(() => {
    dispatch({ type: 'CLEAR_CART' });
  }, []);

  const setDeliveryType = useCallback((type: 'delivery' | 'pickup') => {
    dispatch({ type: 'SET_DELIVERY_TYPE', payload: type });
  }, []);

  const setDeliveryZone = useCallback((zone: string, minOrderAmount: number) => {
    dispatch({ type: 'SET_DELIVERY_ZONE', payload: { zone, minOrderAmount } });
  }, []);

  const setDeliveryFee = useCallback((fee: number) => {
    dispatch({ type: 'SET_DELIVERY_FEE', payload: fee });
  }, []);

  const setContactInfo = useCallback((info: Partial<CartState['contactInfo']>) => {
    dispatch({ type: 'SET_CONTACT_INFO', payload: info });
  }, []);

  const setDeliveryAddress = useCallback((address: Partial<CartState['deliveryAddress']>) => {
    dispatch({ type: 'SET_DELIVERY_ADDRESS', payload: address });
  }, []);

  const setPaymentMethod = useCallback((method: CartState['paymentMethod']) => {
    dispatch({ type: 'SET_PAYMENT_METHOD', payload: method });
  }, []);

  const setLoyaltyPoints = useCallback((points: number) => {
    dispatch({ type: 'SET_LOYALTY_POINTS', payload: points });
  }, []);

  const applyCoupon = useCallback((code: string, discount: number) => {
    dispatch({ type: 'APPLY_COUPON', payload: { code, discount } });
  }, []);

  const removeCoupon = useCallback(() => {
    dispatch({ type: 'REMOVE_COUPON' });
  }, []);

  const setPromotionPromoCode = useCallback((code: string | undefined) => {
    dispatch({ type: 'SET_PROMOTION_PROMO_CODE', payload: code });
  }, []);

  const setSelectedFreeGift = useCallback((promotionId: string, productId: string) => {
    dispatch({ type: 'SET_SELECTED_FREE_GIFT', payload: { promotionId, productId } });
  }, []);

  const declineFreeGift = useCallback((promotionId: string) => {
    dispatch({ type: 'SET_DECLINED_FREE_GIFT', payload: { promotionId } });
  }, []);

  const setSelectedBogoSecond = useCallback((promotionId: string, productId: string) => {
    dispatch({ type: 'SET_SELECTED_BOGO_SECOND', payload: { promotionId, productId } });
  }, []);

  const resetCheckoutData = useCallback(() => {
    dispatch({ type: 'RESET_CHECKOUT_DATA' });
  }, []);
  
  // Derived state
  const cartItemsCount = state.items.reduce(
    (count, item) => count + item.quantity,
    0
  );
  
  // Check if cart meets minimum order requirements
  const canProceedToCheckout =
    state.items.length > 0 &&
    (state.deliveryType !== 'delivery' || totals.subtotal! >= state.minOrderAmount);
  
  const value = {
    state,
    totals,
    dispatch,
    addItem,
    updateItem,
    removeItem,
    clearCart,
    setDeliveryType,
    setDeliveryZone,
    setDeliveryFee,
    setContactInfo,
    setDeliveryAddress,
    setPaymentMethod,
    setLoyaltyPoints,
    applyCoupon,
    removeCoupon,
    setPromotionPromoCode,
    setSelectedFreeGift,
    declineFreeGift,
    setSelectedBogoSecond,
    resetCheckoutData,
    cartItemsCount,
    canProceedToCheckout,
  };
  
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

// Hook for using the cart context
export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
