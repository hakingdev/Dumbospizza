import { createModel } from '../db/mongoose-compat';
import { loyaltyPrograms } from '../db/schema';

export interface ILoyaltyTransaction {
  user: string;
  order?: string;
  amount: number;
  type: 'earn' | 'redeem';
  description: string;
  createdAt: Date | string;
}

export interface ILoyaltyProgram {
  user: string;
  phoneNumber: string;
  balance: number;
  totalEarned: number;
  totalRedeemed: number;
  transactions: ILoyaltyTransaction[];
  createdAt: Date;
  updatedAt: Date;
}

export const LoyaltyProgram = createModel(loyaltyPrograms, {
  methods: {
    async addPoints(
      this: any,
      points: number,
      orderId?: string,
      description: string = 'Points earned from order'
    ) {
      this.transactions = this.transactions || [];
      this.transactions.push({
        user: this.user,
        order: orderId ? String(orderId) : undefined,
        amount: points,
        type: 'earn',
        description,
        createdAt: new Date().toISOString(),
      });
      this.balance = (this.balance || 0) + points;
      this.totalEarned = (this.totalEarned || 0) + points;
      await this.save();
      return this;
    },
    async redeemPoints(
      this: any,
      points: number,
      orderId?: string,
      description: string = 'Points redeemed for discount'
    ) {
      if ((this.balance || 0) < points) {
        throw new Error('Insufficient points balance');
      }
      this.transactions = this.transactions || [];
      this.transactions.push({
        user: this.user,
        order: orderId ? String(orderId) : undefined,
        amount: points,
        type: 'redeem',
        description,
        createdAt: new Date().toISOString(),
      });
      this.balance = (this.balance || 0) - points;
      this.totalRedeemed = (this.totalRedeemed || 0) + points;
      await this.save();
      return this;
    },
  },
});

export default LoyaltyProgram;
