import { like, desc } from 'drizzle-orm';
import db from '../db/client';
import { createModel } from '../db/mongoose-compat';
import { orders, users } from '../db/schema';

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
  status: 'new' | 'preparing' | 'ready_for_delivery' | 'delivering' | 'completed' | 'cancelled';
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
    if (!isNew || doc.orderNumber) return;
    const today = new Date();
    const dateString =
      today.getFullYear().toString().slice(-2) +
      String(today.getMonth() + 1).padStart(2, '0') +
      String(today.getDate()).padStart(2, '0');

    const last = await db
      .select({ orderNumber: orders.orderNumber })
      .from(orders)
      .where(like(orders.orderNumber, `${dateString}%`))
      .orderBy(desc(orders.orderNumber))
      .limit(1);

    let sequenceNumber = '001';
    if (last[0]?.orderNumber) {
      const lastSequence = parseInt(last[0].orderNumber.slice(-3), 10);
      sequenceNumber = String(lastSequence + 1).padStart(3, '0');
    }
    doc.orderNumber = `${dateString}${sequenceNumber}`;

    if (!doc.statusUpdates || doc.statusUpdates.length === 0) {
      doc.statusUpdates = [{ status: doc.status || 'new', timestamp: new Date() }];
    }
  },
});

export default Order;
