import { createModel } from '../db/mongoose-compat';
import { loyaltyTransactions } from '../db/schema';

export type LoyaltyTransactionType = 'earn' | 'redeem' | 'expire' | 'adjust' | 'reverse';

export interface ILoyaltyTransaction {
  user: string;
  order?: string;
  type: LoyaltyTransactionType;
  /** Всегда положительная величина операции (в баллах). */
  amount: number;
  /** Дельта баланса со знаком (+начисление / -списание). */
  delta: number;
  balanceAfter: number;
  description: string;
  /** Для earn: дата сгорания батча. */
  expiresAt?: Date | null;
  /** Сколько баллов из earn-батча уже израсходовано (FIFO). */
  consumed: number;
  createdAt: Date;
}

export const LoyaltyTransaction = createModel(loyaltyTransactions);

export default LoyaltyTransaction;
