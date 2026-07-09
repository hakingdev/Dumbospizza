import { createModel } from '../db/mongoose-compat';
import { orders, users } from '../db/schema';
import { generateNextOrderNumber } from '../orders/order-number';
import { PENDING_PAYMENT_STATUS } from '../orders/payment-draft';

export interface IOrderItem {
  product: string;
  name: string;
  quantity: number;
  price: number;
  /** Имя категории товара — для группировки в кухонном чеке. */
  category?: string;
  /** Ставка НДS товара (доля 0.07 / 0.19) — для налоговой разбивки онлайн-чека. */
  taxRate?: number;
  size?: {
    id: string;
    name: string;
    size: string;
    price: number;
  };
  extras?: {
    toppings?: { id: string; name: string; price: number }[];
    sauces?: { id: string; name: string; price: number }[];
    sides?: { id: string; name: string; price: number }[];
  };
  options?: {
    groupId?: string;
    group: string;
    name: string;
    price: number;
  }[];
  totalPrice: number;
}

export interface IDeliveryAddress {
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
  floor?: string;
  notes?: string;
}

export interface IOrder {
  orderNumber: string;
  user?: string;
  customerName: string;
  phoneNumber: string;
  email?: string;
  /** SMS-Marketing-Einwilligung (opt-in на checkout). */
  smsMarketingConsent?: boolean;
  smsConsentAt?: Date;
  smsConsentText?: string;
  items: IOrderItem[];
  deliveryAddress?: IDeliveryAddress;
  deliveryZone?: {
    id: string;
    name: string;
    minOrderAmount: number;
  };
  deliveryType: 'delivery' | 'pickup';
  deliveryFee: number;
  subtotal: number;
  tax: number;
  discount?: {
    code?: string;
    amount: number;
    type: 'percentage' | 'fixed';
  };
  promotionDiscount?: number;
  promotionPromoCode?: string;
  appliedPromotions?: {
    promotionId: string;
    name: string;
    type: string;
    savedAmount: number;
  }[];
  freeGifts?: {
    productId: string;
    name: string;
    quantity: number;
    promotionId: string;
    label?: string;
  }[];
  loyaltyPointsUsed?: number;
  loyaltyPointsEarned?: number;
  total: number;
  paymentMethod: 'cash' | 'card' | 'online';
  paymentStatus: 'pending' | 'completed' | 'failed';
  /**
   * 'pending_payment' — драфт онлайн-оплаты: не «Новый», невидим для админ-списка,
   * кухни и принт-агента; становится 'new' только после серверного подтверждения
   * оплаты (см. lib/orders/payment-draft.ts).
   */
  status:
    | 'pending_payment'
    | 'new'
    | 'preparing'
    | 'ready_for_delivery'
    | 'delivering'
    | 'completed'
    | 'cancelled';
  notes?: string;
  /** Желаемое время доставки в формате HH:mm (например "16:45") */
  desiredDeliveryTime?: string;
  telegramMessageId?: number;
  mewsOrderId?: string;
  kitchenPrintStatus?: 'pending' | 'printing' | 'completed' | 'failed';
  customerPrintStatus?: 'pending' | 'printing' | 'completed' | 'failed';
  createdAt: Date;
  updatedAt: Date;
  statusUpdates?: {
    status: string;
    timestamp: Date | string;
    updatedBy?: string;
  }[];
}

export const Order = createModel(orders, {
  populate: {
    user: () => users,
  },
  methods: {
    /** Обновление статуса с записью в историю (как Mongoose-метод). */
    async updateStatus(this: any, status: IOrder['status'], userId?: string) {
      this.status = status;
      this.statusUpdates = this.statusUpdates || [];
      this.statusUpdates.push({ status, timestamp: new Date(), updatedBy: userId });
      await this.save();
      return this;
    },
  },
  // Генерация orderNumber (YYMMDD + порядковый номер) и стартовая запись истории.
  preSave: async (doc, isNew) => {
    if (!isNew) return;

    if (!doc.statusUpdates || doc.statusUpdates.length === 0) {
      doc.statusUpdates = [{ status: doc.status || 'new', timestamp: new Date() }];
    }

    // Драфт онлайн-оплаты номер НЕ получает: нумерация происходит при промоуте
    // после подтверждения оплаты (см. lib/orders/payment-draft.ts) — брошенные
    // попытки оплаты не съедают номера и не видны как заказы.
    if (doc.orderNumber || doc.status === PENDING_PAYMENT_STATUS) return;

    doc.orderNumber = await generateNextOrderNumber();
  },
});

export default Order;
