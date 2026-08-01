import { createModel } from '../db/mongoose-compat';
import { coupons } from '../db/schema';
import { normalizeCouponUsageLimit } from '../promotions/coupon-validity';

export interface CouponDocument {
  code: string;
  description?: string;
  discountType: 'fixed' | 'percentage';
  discountValue: number;
  validFrom: Date;
  validTo: Date;
  minOrderAmount?: number;
  usageLimit?: number;
  usageCount: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const Coupon = createModel(coupons, {
  methods: {
    /** Виртуал isValid из Mongoose-модели (теперь обычная функция). */
    isValid(this: any): boolean {
      const now = new Date();
      // Лимит: пусто/0 = без ограничений (та же семантика, что в isCouponCurrentlyValid).
      const usageLimit = normalizeCouponUsageLimit(this.usageLimit);
      return (
        this.active &&
        now >= new Date(this.validFrom) &&
        now <= new Date(this.validTo) &&
        (usageLimit == null || this.usageCount < usageLimit)
      );
    },
    isValidForOrder(this: any, orderAmount: number): boolean {
      if (!this.isValid()) return false;
      if (this.minOrderAmount && orderAmount < this.minOrderAmount) return false;
      return true;
    },
    calculateDiscount(this: any, orderAmount: number): number {
      if (!this.isValidForOrder(orderAmount)) return 0;
      if (this.discountType === 'fixed') {
        return Math.min(this.discountValue, orderAmount);
      }
      return Math.min(orderAmount * (this.discountValue / 100), orderAmount);
    },
    /** Увеличение счётчика использования купона. */
    use(this: any) {
      this.usageCount = (this.usageCount || 0) + 1;
      return this.save();
    },
  },
});

export default Coupon;
