import { describe, it, expect } from 'vitest';
import { cartReducer } from '../CartContext';

/**
 * QA #9/#11: «+/−» на одной позиции меняло количество ВСЕХ строк, а удаление
 * одной позиции стирало корзину. Причина — дубликаты id строк: ProductModal
 * ставит id = product._id (два размера одного товара → один id), «повторить
 * заказ» давал одинаковые id всем строкам товара. UPDATE_ITEM/REMOVE_ITEM
 * адресуют строку по id → задевали все совпадающие.
 */
function baseState(over: Record<string, any> = {}): any {
  return {
    items: [],
    subtotal: 0,
    tax: 0,
    deliveryFee: 0,
    zoneDeliveryFee: 0,
    freeDeliveryThreshold: 0,
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
    contactInfo: { name: '', phoneNumber: '' },
    ...over,
  };
}

const bayern20 = {
  id: 'prodX',
  productId: 'prodX',
  name: 'Bayern Pizza',
  quantity: 1,
  price: 8.9,
  basePrice: 8.9,
  size: { id: 's20', name: 'ca. 20x20' },
};
const bayern40 = {
  ...bayern20,
  price: 16.9,
  size: { id: 's40', name: 'ca. 30x40' },
};

describe('cartReducer — уникальные id строк корзины', () => {
  it('один товар в двух размерах → две строки с РАЗНЫМИ id', () => {
    let state = cartReducer(baseState(), { type: 'ADD_ITEM', payload: bayern20 } as any);
    state = cartReducer(state, { type: 'ADD_ITEM', payload: bayern40 } as any);

    expect(state.items).toHaveLength(2);
    expect(state.items[0].id).not.toBe(state.items[1].id);
    // товарная принадлежность сохраняется у обеих строк
    expect(state.items.map((i: any) => i.productId)).toEqual(['prodX', 'prodX']);
  });

  it('«+» на второй строке меняет ТОЛЬКО её (QA #9)', () => {
    let state = cartReducer(baseState(), { type: 'ADD_ITEM', payload: bayern20 } as any);
    state = cartReducer(state, { type: 'ADD_ITEM', payload: bayern40 } as any);
    const secondId = state.items[1].id;

    state = cartReducer(state, {
      type: 'UPDATE_ITEM',
      payload: { id: secondId, updates: { quantity: 3 } },
    } as any);

    expect(state.items[0].quantity).toBe(1);
    expect(state.items[1].quantity).toBe(3);
  });

  it('удаление одной строки не стирает соседнюю того же товара (QA #11)', () => {
    let state = cartReducer(baseState(), { type: 'ADD_ITEM', payload: bayern20 } as any);
    state = cartReducer(state, { type: 'ADD_ITEM', payload: bayern40 } as any);

    state = cartReducer(state, { type: 'REMOVE_ITEM', payload: state.items[1].id } as any);

    expect(state.items).toHaveLength(1);
    expect(state.items[0].size.id).toBe('s20');
  });

  it('тот же товар, тот же размер → мердж количества (дедуп не сломан)', () => {
    let state = cartReducer(baseState(), { type: 'ADD_ITEM', payload: bayern20 } as any);
    state = cartReducer(state, { type: 'ADD_ITEM', payload: { ...bayern20, quantity: 2 } } as any);

    expect(state.items).toHaveLength(1);
    expect(state.items[0].quantity).toBe(3);
  });

  it('товарная страница (уникальный id на клик) теперь тоже мержится по товару', () => {
    // product/[id]/page.tsx ставит id = `${product._id}-${Date.now()}` — раньше
    // одинаковые позиции никогда не мержились и плодили дубли строк.
    let state = cartReducer(baseState(), {
      type: 'ADD_ITEM',
      payload: { ...bayern20, id: 'prodX-111' },
    } as any);
    state = cartReducer(state, {
      type: 'ADD_ITEM',
      payload: { ...bayern20, id: 'prodX-222' },
    } as any);

    expect(state.items).toHaveLength(1);
    expect(state.items[0].quantity).toBe(2);
  });

  it('третья строка того же товара получает следующий свободный суффикс', () => {
    let state = cartReducer(baseState(), { type: 'ADD_ITEM', payload: bayern20 } as any);
    state = cartReducer(state, { type: 'ADD_ITEM', payload: bayern40 } as any);
    state = cartReducer(state, {
      type: 'ADD_ITEM',
      payload: { ...bayern20, size: { id: 's60', name: 'ca. 60x40' } },
    } as any);

    const ids = state.items.map((i: any) => i.id);
    expect(new Set(ids).size).toBe(3);
  });
});
