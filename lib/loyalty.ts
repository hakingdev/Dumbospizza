/**
 * Тонкие лукапы программы лояльности (по телефону / пользователю) и создание
 * записи. Бизнес-логика баллов (начисление/списание/реверс/уровни/сгорание)
 * вынесена в lib/loyalty/service.ts и работает атомарно на сырых Drizzle-апдейтах
 * с журналом в loyalty_transactions.
 */
import { LoyaltyProgram, ILoyaltyProgram } from './models/loyalty.model';
import { User } from './models/user.model';
import { connectToDatabase } from './models';

/** Программа лояльности по номеру телефона. */
export async function getLoyaltyByPhone(phoneNumber: string): Promise<ILoyaltyProgram | null> {
  await connectToDatabase();
  return LoyaltyProgram.findOne({ phoneNumber });
}

/** Программа лояльности по userId. */
export async function getLoyaltyByUser(userId: string): Promise<ILoyaltyProgram | null> {
  await connectToDatabase();
  return LoyaltyProgram.findOne({ user: userId });
}

/** Создать запись программы лояльности для пользователя (идемпотентно). */
export async function createLoyaltyProgram(
  userId: string,
  phoneNumber: string
): Promise<ILoyaltyProgram> {
  await connectToDatabase();

  const existing = await LoyaltyProgram.findOne({
    $or: [{ user: userId }, { phoneNumber }],
  });
  if (existing) return existing;

  const loyaltyProgram = new LoyaltyProgram({
    user: userId,
    phoneNumber,
    balance: 0,
    totalEarned: 0,
    totalRedeemed: 0,
    transactions: [],
  });
  await loyaltyProgram.save();
  return loyaltyProgram;
}

// Реэкспорт сервисных функций для удобства существующих импортов.
export {
  earnForCompletedOrder,
  redeemPoints,
  redeemPointsForOrder,
  reverseOrder,
  getLoyaltySummary,
  getTransactions,
  getTier,
  adjustPoints,
  expirePoints,
} from './loyalty/service';
