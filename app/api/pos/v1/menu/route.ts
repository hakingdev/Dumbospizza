import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../lib/models';
import { Product } from '../../../../../lib/models/product.model';
import { Category } from '../../../../../lib/models/category.model';
import { authorizePos } from '../../../../../lib/pos/auth';
import {
  toMenuItem,
  type PosMenuCategory,
} from '../../../../../lib/pos/menu';

export const dynamic = 'force-dynamic';

/**
 * Меню и стоп-лист прямо с кухни (экраны 09 · Kategorien и 10 · Artikel).
 *
 * Своего понятия «стоп-лист» здесь нет: гасится то же поле `available` у товара
 * (и `sizes[].active` у размера), которым уже управляет админка и по которому
 * витрина, приложение и приём заказов решают, продавать позицию или нет.
 * Отдельный список «выключено на кухне» разошёлся бы с сайтом в первый же вечер.
 *
 * Маршрут узкий намеренно: терминалу нужны название, цена и выключатель, а не
 * весь товар с картинками и группами опций — прибор читает это по Wi-Fi кухни.
 */

/**
 * GET /api/pos/v1/menu             — категории со счётчиком стоп-листа
 * GET /api/pos/v1/menu?category=id — позиции одной категории
 */
export async function GET(request: NextRequest) {
  const auth = await authorizePos(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const categoryId = request.nextUrl.searchParams.get('category');

    if (categoryId) {
      const products = await Product.find({ category: categoryId }).sort({ name: 1 }).lean();
      const category: any = await Category.findById(categoryId).lean();
      return NextResponse.json(
        {
          success: true,
          category: { id: categoryId, name: String(category?.name ?? '') },
          items: (products as any[]).map(toMenuItem),
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Только активные категории: скрытая в админке категория не должна
    // всплывать на кухне — там её погасить нечем.
    const [categories, products] = await Promise.all([
      Category.find({ active: true }).sort({ order: 1 }).lean(),
      Product.find({}).lean(),
    ]);

    // Считаем в памяти, а не запросом на категорию: категорий десяток, товаров
    // сотни — один проход дешевле десяти обращений к базе.
    const stats = new Map<string, { total: number; stopped: number }>();
    for (const product of products as any[]) {
      const key = String(product.category ?? '');
      const stat = stats.get(key) ?? { total: 0, stopped: 0 };
      stat.total += 1;
      if (product.available === false) stat.stopped += 1;
      stats.set(key, stat);
    }

    const list: PosMenuCategory[] = (categories as any[]).map((category) => {
      const stat = stats.get(String(category._id)) ?? { total: 0, stopped: 0 };
      return {
        id: String(category._id),
        name: String(category.name ?? ''),
        itemCount: stat.total,
        stoppedCount: stat.stopped,
      };
    });

    return NextResponse.json(
      { success: true, categories: list },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: any) {
    console.error('[pos] menu read error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * PATCH /api/pos/v1/menu — { productId, available } либо { productId, sizeId, active }
 *
 * Размер отдельным полем, потому что гасят обычно именно его: кончилось тесто
 * на Ø 30, а Ø 26 продаётся дальше. Гасить всё блюдо в этом случае — потерянные
 * деньги за вечер.
 */
export async function PATCH(request: NextRequest) {
  const auth = await authorizePos(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const productId = String(body?.productId ?? '').trim();
    if (!productId) {
      return NextResponse.json({ success: false, error: 'productId fehlt' }, { status: 400 });
    }

    await connectToDatabase();
    const product: any = await Product.findById(productId);
    if (!product) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const sizeId = body?.sizeId ? String(body.sizeId) : '';
    if (sizeId) {
      const sizes = (product.sizes ?? []).map((size: any) =>
        String(size.id ?? size.name) === sizeId ? { ...size, active: Boolean(body.active) } : size
      );
      // Доступность блюда идёт за размерами: включённый обратно размер обязан
      // вернуть позицию, а погашенный последний — убрать её. Иначе на витрине
      // остаётся блюдо, у которого нечего выбрать.
      await Product.findByIdAndUpdate(productId, {
        sizes,
        available: sizes.some((size: any) => size.active !== false),
      });
    } else {
      await Product.findByIdAndUpdate(productId, { available: Boolean(body.available) });
    }

    console.log(
      `[pos] menu ${sizeId ? `size ${sizeId}` : 'item'} product=${productId} by=${auth.caller.kind}`
    );

    const updated: any = await Product.findById(productId).lean();
    return NextResponse.json({ success: true, item: toMenuItem(updated) });
  } catch (error: any) {
    console.error('[pos] menu write error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
