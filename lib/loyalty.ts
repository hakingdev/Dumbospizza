import { LoyaltyProgram, ILoyaltyProgram } from './models/loyalty.model';
import { User } from './models/user.model';
import { connectToDatabase } from './models';

/**
 * Points conversion rates
 * - Earning: 1 euro spent = 10 points
 * - Redeeming: 100 points = 1 euro discount
 */
const POINTS_PER_EURO = 10;
const EUROS_PER_100_POINTS = 1;

/**
 * Get loyalty program for a user by phone number
 * @param phoneNumber User's phone number
 */
export async function getLoyaltyByPhone(phoneNumber: string): Promise<ILoyaltyProgram | null> {
  await connectToDatabase();
  
  // Find loyalty program by phone
  return await LoyaltyProgram.findOne({ phoneNumber });
}

/**
 * Get loyalty program for a user by user ID
 * @param userId User's ID
 */
export async function getLoyaltyByUser(userId: string): Promise<ILoyaltyProgram | null> {
  await connectToDatabase();
  
  // Find loyalty program by user ID
  return await LoyaltyProgram.findOne({ user: userId });
}

/**
 * Create a new loyalty program for a user
 * @param userId User's ID
 * @param phoneNumber User's phone number
 */
export async function createLoyaltyProgram(
  userId: string, 
  phoneNumber: string
): Promise<ILoyaltyProgram> {
  await connectToDatabase();
  
  // Check if user exists
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }
  
  // Check if loyalty program already exists for this user or phone
  const existingLoyalty = await LoyaltyProgram.findOne({ 
    $or: [{ user: userId }, { phoneNumber }] 
  });
  
  if (existingLoyalty) {
    throw new Error('Loyalty program already exists for this user or phone number');
  }
  
  // Create new loyalty program
  const loyaltyProgram = new LoyaltyProgram({
    user: userId,
    phoneNumber,
    balance: 0,
    totalEarned: 0,
    totalRedeemed: 0,
    transactions: []
  });
  
  // Save to database
  await loyaltyProgram.save();
  
  return loyaltyProgram;
}

/**
 * Calculate points to earn based on order amount
 * @param amount Order amount in euros
 */
export function calculatePointsToEarn(amount: number): number {
  return Math.floor(amount * POINTS_PER_EURO);
}

/**
 * Calculate discount value based on points to redeem
 * @param points Points to redeem
 */
export function calculateDiscountFromPoints(points: number): number {
  return (points / 100) * EUROS_PER_100_POINTS;
}

/**
 * Add loyalty points for an order
 * @param phoneNumber User's phone number
 * @param amount Order amount in euros
 * @param orderId Order ID
 */
export async function addLoyaltyPoints(
  phoneNumber: string,
  amount: number,
  orderId?: string
): Promise<ILoyaltyProgram | null> {
  await connectToDatabase();
  
  // Find loyalty program
  let loyaltyProgram = await LoyaltyProgram.findOne({ phoneNumber });
  
  // If program doesn't exist, try to find the user and create one
  if (!loyaltyProgram) {
    const user = await User.findOne({ phoneNumber });
    if (!user) return null; // Can't add points if user doesn't exist
    
    // Create loyalty program for this user
    loyaltyProgram = await createLoyaltyProgram(user._id.toString(), phoneNumber);
  }
  
  // Calculate points to add
  const pointsToAdd = calculatePointsToEarn(amount);
  
  // Add points to loyalty program
  await loyaltyProgram.addPoints(
    pointsToAdd,
    orderId,
    `Points earned from order ${orderId || 'unknown'}`
  );
  
  return loyaltyProgram;
}

/**
 * Redeem loyalty points
 * @param phoneNumber User's phone number
 * @param points Points to redeem
 * @param orderId Order ID
 */
export async function redeemLoyaltyPoints(
  phoneNumber: string,
  points: number,
  orderId?: string
): Promise<{ success: boolean, discount: number, loyalty: ILoyaltyProgram | null }> {
  await connectToDatabase();
  
  try {
    // Find loyalty program
    const loyaltyProgram = await LoyaltyProgram.findOne({ phoneNumber });
    
    // If no loyalty program or not enough points
    if (!loyaltyProgram || loyaltyProgram.balance < points) {
      return { 
        success: false, 
        discount: 0,
        loyalty: loyaltyProgram 
      };
    }
    
    // Calculate discount value
    const discountValue = calculateDiscountFromPoints(points);
    
    // Redeem points
    await loyaltyProgram.redeemPoints(
      points,
      orderId,
      `Points redeemed for €${discountValue.toFixed(2)} discount on order ${orderId || 'unknown'}`
    );
    
    return {
      success: true,
      discount: discountValue,
      loyalty: loyaltyProgram
    };
  } catch (error) {
    console.error('Error redeeming points:', error);
    return { success: false, discount: 0, loyalty: null };
  }
}

/**
 * Get loyalty point transactions for a user
 * @param phoneNumber User's phone number
 * @param limit Number of transactions to return
 * @param skip Number of transactions to skip (for pagination)
 */
export async function getLoyaltyTransactions(
  phoneNumber: string,
  limit: number = 20,
  skip: number = 0
): Promise<{ transactions: any[], total: number } | null> {
  await connectToDatabase();
  
  // Find loyalty program
  const loyaltyProgram = await LoyaltyProgram.findOne({ phoneNumber });
  
  if (!loyaltyProgram) return null;
  
  // Get transactions with pagination
  const transactions = loyaltyProgram.transactions
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(skip, skip + limit);
  
  return {
    transactions,
    total: loyaltyProgram.transactions.length
  };
}
