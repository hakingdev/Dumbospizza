import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { User } from '../../../../lib/models/user.model';
import { Order } from '../../../../lib/models/order.model';
import { Product } from '../../../../lib/models/product.model';
import { getCustomerSession } from '../../../../lib/customer-auth';
import { aggregateFavorites } from '../../../../lib/orders/favorites';

const LIMIT = 6;
const MIN_FAVORITES = 3; // мало данных → дополняем популярными по сайту

// GET /api/customer/favorites — любимые товары клиента (вычисляемая аналитика)
export async function GET(request: NextRequest) {
  const session = getCustomerSession(request);
  if (!session) {
    return NextResponse.json({ success: false, error: 'Nicht angemeldet' }, { status: 401 });
  }
  try {
    await connectToDatabase();
    const user = await User.findById(session.userId);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Nicht gefunden' }, { status: 404 });
    }

    const orders = await Order.find({
      $or: [{ user: session.userId }, { phoneNumber: user.phoneNumber }],
    })
      .sort({ createdAt: -1 })
      .limit(100);

    const favorites = aggregateFavorites(orders as any[], LIMIT);

    // Подтянуть картинки/доступность товаров.
    const ids = favorites.map((f) => f.productId).filter(Boolean);
    const productsById = new Map<string, any>();
    if (ids.length) {
      const products = await Product.find({ _id: { $in: ids } })
        .select('name image available')
        .lean();
      for (const p of products) productsById.set(String((p as any)._id), p);
    }

    type FavoriteItem = {
      productId: string;
      name: string;
      image: string;
      orderCount: number;
      totalQuantity: number;
      available: boolean;
      source: 'history' | 'popular';
    };

    const items: FavoriteItem[] = favorites.map((f) => {
      const p = productsById.get(f.productId);
      return {
        productId: f.productId,
        name: p?.name || f.name,
        image: p?.image || '/images/default-product.jpg',
        orderCount: f.orderCount,
        totalQuantity: f.totalQuantity,
        available: p ? p.available !== false : true,
        source: 'history',
      };
    });

    // Fallback: данных мало → дополняем популярными (featured) товарами.
    if (items.length < MIN_FAVORITES) {
      const existing = new Set(items.map((i) => i.productId));
      const popular = await Product.find({ featured: true, available: true })
        .select('name image')
        .limit(LIMIT)
        .lean();
      for (const p of popular) {
        const pid = String((p as any)._id);
        if (existing.has(pid) || items.length >= LIMIT) continue;
        items.push({
          productId: pid,
          name: (p as any).name,
          image: (p as any).image || '/images/default-product.jpg',
          orderCount: 0,
          totalQuantity: 0,
          available: true,
          source: 'popular' as const,
        });
        existing.add(pid);
      }
    }

    return NextResponse.json({ success: true, favorites: items });
  } catch (error: any) {
    console.error('customer/favorites GET:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
