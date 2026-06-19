import { sql } from 'drizzle-orm';
import db from './client';
import { Product } from '../models/product.model';
import { Category } from '../models/category.model';
import { Order } from '../models/order.model';
import { User } from '../models/user.model';
import { LoyaltyProgram } from '../models/loyalty.model';

/**
 * Database utility functions for common operations.
 * Простые операции идут через Mongoose-совместимый слой (lib/db/mongoose-compat),
 * агрегации и транзакции написаны на Drizzle напрямую.
 */

// Products
export async function getProducts({ category, available, featured, valentinePromo }: { category?: string, available?: boolean, featured?: boolean, valentinePromo?: boolean } = {}) {
  const query: any = {};

  if (category) {
    const categoryDoc = await Category.findOne({ slug: category });
    if (categoryDoc) {
      query.category = categoryDoc._id;
    } else {
      return [];
    }
  }

  if (available !== undefined) query.available = available;
  if (featured !== undefined) query.featured = featured;
  if (valentinePromo !== undefined) query.valentinePromo = valentinePromo;

  return Product.find(query).sort({ name: 1 }).populate('category');
}

export async function getProductById(id: string) {
  return Product.findById(id).populate('category');
}

export async function searchProducts(searchTerm: string) {
  const regex = new RegExp(searchTerm, 'i');
  return Product.find({
    $or: [{ name: regex }, { description: regex }],
  }).populate('category');
}

// Categories
export async function getCategories({ active }: { active?: boolean } = {}) {
  const query: any = {};
  if (active !== undefined) query.active = active;
  return Category.find(query).sort({ order: 1 });
}

// Orders
export async function getRecentOrders(limit = 10) {
  return Order.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('user', 'name phoneNumber');
}

export async function getOrdersByStatus(status: string) {
  return Order.find({ status })
    .sort({ createdAt: -1 })
    .populate('user', 'name phoneNumber');
}

export async function getOrdersByPhone(phoneNumber: string) {
  return Order.find({ phoneNumber }).sort({ createdAt: -1 });
}

export async function getDailySales(days = 7) {
  const date = new Date();
  date.setDate(date.getDate() - days);

  const rows: any = await db.execute(sql`
    SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date,
           SUM(total) AS "totalSales",
           COUNT(*)::int AS count
    FROM orders
    WHERE created_at >= ${date.toISOString()}::timestamptz AND status <> 'cancelled'
    GROUP BY 1
    ORDER BY 1
  `);

  const list: any[] = Array.isArray(rows) ? rows : rows?.rows ?? [];
  return list.map((r) => ({
    date: r.date as string,
    totalSales: Number(r.totalSales) || 0,
    count: Number(r.count) || 0,
  }));
}

// Users
export async function getUserByPhone(phoneNumber: string) {
  return User.findOne({ phoneNumber });
}

export async function getUserWithOrders(userId: string) {
  const user = await User.findById(userId);
  const orders = await Order.find({ user: userId }).sort({ createdAt: -1 });
  return { user, orders };
}

// Statistics
export async function getAdminDashboardStats() {
  const totalOrders = await Order.countDocuments();
  const totalProducts = await Product.countDocuments();
  const totalCategories = await Category.countDocuments();
  const totalUsers = await User.countDocuments();
  const totalLoyaltyUsers = await LoyaltyProgram.countDocuments();

  const pendingOrders = await Order.countDocuments({
    status: { $in: ['new', 'preparing', 'ready_for_delivery', 'delivering'] },
  });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayOrders = await Order.countDocuments({
    createdAt: { $gte: todayStart },
  });

  const salesRows: any = await db.execute(sql`
    SELECT COALESCE(SUM(total), 0) AS total
    FROM orders
    WHERE created_at >= ${todayStart.toISOString()}::timestamptz AND status <> 'cancelled'
  `);
  const salesList: any[] = Array.isArray(salesRows) ? salesRows : salesRows?.rows ?? [];
  const todaySales = Number(salesList[0]?.total) || 0;

  return {
    totalOrders,
    totalProducts,
    totalCategories,
    totalUsers,
    totalLoyaltyUsers,
    pendingOrders,
    todayOrders,
    todaySales,
  };
}

/**
 * Создание заказа с начислением/списанием лояльности.
 * Примечание: выполняется последовательно (без единой транзакции) — функция
 * в текущем коде не вызывается; основной поток заказа использует lib/loyalty.ts.
 */
export async function createOrderWithLoyalty(
  orderData: any,
  loyaltyOptions: { phoneNumber: string; pointsToRedeem?: number } | null
) {
  try {
    const order: any = new (Order as any)(orderData);
    await order.save();

    if (loyaltyOptions) {
      const { phoneNumber, pointsToRedeem } = loyaltyOptions;

      let loyalty: any = await LoyaltyProgram.findOne({ phoneNumber });

      if (!loyalty && phoneNumber) {
        const user = await User.findOne({ phoneNumber });
        if (user) {
          loyalty = new (LoyaltyProgram as any)({
            user: user._id,
            phoneNumber,
            balance: 0,
            totalEarned: 0,
            totalRedeemed: 0,
            transactions: [],
          });
          await loyalty.save();
        }
      }

      if (loyalty) {
        if (pointsToRedeem && pointsToRedeem > 0) {
          if (loyalty.balance < pointsToRedeem) {
            throw new Error('Insufficient loyalty points balance');
          }
          const pointValue = (pointsToRedeem / 100).toFixed(2);
          await loyalty.redeemPoints(
            pointsToRedeem,
            order._id,
            `Points redeemed for €${pointValue} discount on order ${order.orderNumber}`
          );
          order.loyaltyPointsUsed = pointsToRedeem;
          await order.save();
        }

        const pointsToAdd = Math.floor(order.total * 10);
        if (pointsToAdd > 0) {
          await loyalty.addPoints(
            pointsToAdd,
            order._id,
            `Points earned from order ${order.orderNumber}`
          );
          order.loyaltyPointsEarned = pointsToAdd;
          await order.save();
        }
      }
    }

    return { success: true, order };
  } catch (error) {
    console.error('Transaction error:', error);
    return { success: false, error };
  }
}
