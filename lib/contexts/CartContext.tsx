"use client";

import React, { createContext, useContext, useReducer, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { PromotionCalculationResult } from '../promotions/types';
import { calculatePromotions as fetchPromotionCalculation } from '../api-client';
import { normalizeObjectId } from '../normalize-id';
import { getAppliedPromotionDiscount, getBogoPickerMerchandise } from '../promotions/discount-total';

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
  promotionPromoCode?: string;
  promotionCalculation: PromotionCalculationResult | null;
  /** promotionId → productId для Gratis-Auswahl (1 aus N) */
  selectedFreeGifts: Record<string, string>;
  /** promotionId → productId для BOGO 2. zum halben Preis */
  selectedBogoSecond: Record<string, string[]>;
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
  paymentMethod?: 'cash' | 'card' | 'online';
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
  | { type: 'SET_PROMOTION_PROMO_CODE'; payload: string | undefined }
  | { type: 'SET_SELECTED_FREE_GIFT'; payload: { promotionId: string; productId: string } }
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
  promotionCalculation: null,
  selectedFreeGifts: {},
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

  const loyaltyPointsDiscount = state.loyaltyPointsToRedeem / 100; // 100 points = 1 euro
  const couponDiscount = state.couponDiscount || 0;
  const bogoSecondTotal = getBogoPickerMerchandise(state.promotionCalculation);
  const promotionDiscount = getAppliedPromotionDiscount(state.promotionCalculation);

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

// Cart reducer
function cartReducer(state: CartState, action: CartAction): CartState {
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
      
      const newState = { ...state, items: newItems };
      return {
        ...newState,
        ...calculateTotals(newState),
      };
    }
    
    case 'UPDATE_ITEM': {
      const newItems = state.items.map(item =>
        item.id === action.payload.id ? { ...item, ...action.payload.updates } : item
      );
      
      const newState = { ...state, items: newItems };
      return {
        ...newState,
        ...calculateTotals(newState),
      };
    }
    
    case 'REMOVE_ITEM': {
      const newItems = state.items.filter(item => item.id !== action.payload);
      const newState = { ...state, items: newItems };
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
      const newState = {
        ...state,
        couponCode: undefined,
        couponDiscount: 0,
      };
      return {
        ...newState,
        ...calculateTotals(newState),
      };
    }

    case 'SET_PROMOTION_CALCULATION': {
      const payload = action.payload;
      let selectedFreeGifts: Record<string, string> = {};
      let selectedBogoSecond: Record<string, string[]> = {};
      if (payload) {
        const fromResolvedGifts = Object.fromEntries(
          (payload.freeGifts || []).map((gift) => [gift.promotionId, gift.productId])
        );
        if (payload.freeGiftOffers?.length) {
          const validOffers = new Set(payload.freeGiftOffers.map((o) => o.promotionId));
          const pendingSelections = Object.fromEntries(
            Object.entries(state.selectedFreeGifts).filter(([promotionId, productId]) => {
              if (!validOffers.has(promotionId)) return false;
              const offer = payload.freeGiftOffers!.find((o) => o.promotionId === promotionId);
              return offer?.options.some((o) => o.productId === productId) ?? false;
            })
          );
          selectedFreeGifts = { ...fromResolvedGifts, ...pendingSelections };
        } else {
          selectedFreeGifts = fromResolvedGifts;
        }

        // Несколько наград на акцию: группируем выбранные позиции по promotionId.
        // Движок — источник истины (резолвит выбор в bogoSecondItems с учётом лимита пар).
        const grouped: Record<string, string[]> = {};
        for (const item of payload.bogoSecondItems || []) {
          const key = item.id || item.productId;
          (grouped[item.promotionId] = grouped[item.promotionId] || []).push(key);
        }
        selectedBogoSecond = grouped;
      }
      const newState = {
        ...state,
        promotionCalculation: payload,
        selectedFreeGifts,
        selectedBogoSecond,
      };
      return { ...newState, ...calculateTotals(newState) };
    }

    case 'SET_SELECTED_FREE_GIFT': {
      const newState = {
        ...state,
        selectedFreeGifts: {
          ...state.selectedFreeGifts,
          [action.payload.promotionId]: action.payload.productId,
        },
      };
      return newState;
    }

    case 'CLEAR_SELECTED_FREE_GIFTS':
      return { ...state, selectedFreeGifts: {} };

    case 'SET_SELECTED_BOGO_SECOND': {
      // Добавляем ещё одну награду к акции (несколько за несколько пар).
      const prev = state.selectedBogoSecond[action.payload.promotionId] || [];
      const newState = {
        ...state,
        selectedBogoSecond: {
          ...state.selectedBogoSecond,
          [action.payload.promotionId]: [...prev, action.payload.productId],
        },
      };
      return newState;
    }

    case 'SET_PROMOTION_PROMO_CODE': {
      const newState = { ...state, promotionPromoCode: action.payload };
      return newState;
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
        const savedCart = localStorage.getItem('pizza-cart');
        if (savedCart) {
          const parsed = JSON.parse(savedCart);
          const loaded = {
            ...initialState,
            ...parsed,
            selectedFreeGifts: parsed.selectedFreeGifts || {},
            // нормализуем к массивам (старый формат мог хранить одну строку)
            selectedBogoSecond: Object.fromEntries(
              Object.entries(parsed.selectedBogoSecond || {}).map(([k, v]) => [
                k,
                Array.isArray(v) ? v : v ? [v] : [],
              ])
            ),
            items: Array.isArray(parsed.items)
              ? parsed.items.map((item: CartItem) => ({
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
  
  // Save cart to localStorage when it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('pizza-cart', JSON.stringify(state));
    }
  }, [state]);

  const recalculatePromotions = useCallback(async () => {
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
          ([promotionId, ids]) => (ids || []).map((productId) => ({ promotionId, productId }))
        ),
        selectedFreeGifts: Object.entries(state.selectedFreeGifts).map(
          ([promotionId, productId]) => ({ promotionId, productId })
        ),
      });
      if (res.success) {
        dispatch({ type: 'SET_PROMOTION_CALCULATION', payload: res.calculation });
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
  
  // Cart utility functions
  const addItem = (item: CartItem) => {
    dispatch({ type: 'ADD_ITEM', payload: item });
  };
  
  const updateItem = (id: string, updates: Partial<CartItem>) => {
    dispatch({ type: 'UPDATE_ITEM', payload: { id, updates } });
  };
  
  const removeItem = (id: string) => {
    dispatch({ type: 'REMOVE_ITEM', payload: id });
  };
  
  const clearCart = () => {
    dispatch({ type: 'CLEAR_CART' });
  };
  
  const setDeliveryType = (type: 'delivery' | 'pickup') => {
    dispatch({ type: 'SET_DELIVERY_TYPE', payload: type });
  };
  
  const setDeliveryZone = (zone: string, minOrderAmount: number) => {
    dispatch({ type: 'SET_DELIVERY_ZONE', payload: { zone, minOrderAmount } });
  };
  
  const setDeliveryFee = (fee: number) => {
    dispatch({ type: 'SET_DELIVERY_FEE', payload: fee });
  };
  
  const setContactInfo = (info: Partial<CartState['contactInfo']>) => {
    dispatch({ type: 'SET_CONTACT_INFO', payload: info });
  };
  
  const setDeliveryAddress = (address: Partial<CartState['deliveryAddress']>) => {
    dispatch({ type: 'SET_DELIVERY_ADDRESS', payload: address });
  };
  
  const setPaymentMethod = (method: CartState['paymentMethod']) => {
    dispatch({ type: 'SET_PAYMENT_METHOD', payload: method });
  };
  
  const setLoyaltyPoints = (points: number) => {
    dispatch({ type: 'SET_LOYALTY_POINTS', payload: points });
  };
  
  const applyCoupon = (code: string, discount: number) => {
    dispatch({ type: 'APPLY_COUPON', payload: { code, discount } });
  };
  
  const removeCoupon = () => {
    dispatch({ type: 'REMOVE_COUPON' });
  };

  const setPromotionPromoCode = (code: string | undefined) => {
    dispatch({ type: 'SET_PROMOTION_PROMO_CODE', payload: code });
  };

  const setSelectedFreeGift = (promotionId: string, productId: string) => {
    dispatch({ type: 'SET_SELECTED_FREE_GIFT', payload: { promotionId, productId } });
  };

  const setSelectedBogoSecond = (promotionId: string, productId: string) => {
    dispatch({ type: 'SET_SELECTED_BOGO_SECOND', payload: { promotionId, productId } });
  };
  
  const resetCheckoutData = () => {
    dispatch({ type: 'RESET_CHECKOUT_DATA' });
  };
  
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
