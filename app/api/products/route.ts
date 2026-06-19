import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../lib/models';
import { getProducts, searchProducts } from '../../../lib/db/utils';
import { getMewsPosEnabled } from '../../../lib/settings';
import { fetchMewsPosProducts } from '../../../lib/mews-pos/sync';
import { Category } from '../../../lib/models/category.model';
import { getServerSession } from 'next-auth';
import { authOptions, isStaff } from '../../../lib/auth';

async function isAuthorized() {
  const session = await getServerSession(authOptions);
  return isStaff(session);
}

// GET /api/products - Get all products or filter by category
export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    
    const { searchParams } = request.nextUrl;
    const category = searchParams.get('category');
    const available = searchParams.get('available');
    const featured = searchParams.get('featured');
    const valentinePromo = searchParams.get('valentinePromo');
    const search = searchParams.get('search');
    const limit = searchParams.get('limit');
    const source = searchParams.get('source');
    
    let products;
    const mewsEnabled = source === 'mews' || (source !== 'local' && await getMewsPosEnabled());

    const categoryFilter = category || undefined;

    if (mewsEnabled) {
      // slug или Mews product-type id — без подмены через Mongo Category
      products = await fetchMewsPosProducts({
        categorySlug: categoryFilter,
        available: available ? available === 'true' : undefined,
        featured: featured ? featured === 'true' : undefined,
        search: search || undefined
      });
    } else {
      if (search) {
        products = await searchProducts(search);
      } else {
        products = await getProducts({
          category: categoryFilter,
          available: available ? available === 'true' : undefined,
          featured: featured ? featured === 'true' : undefined,
          valentinePromo: valentinePromo ? valentinePromo === 'true' : undefined
        });
      }
    }
    
    // Apply limit if specified
    if (limit) {
      products = products.slice(0, parseInt(limit, 10));
    }
    
    return NextResponse.json({ success: true, products });
  } catch (error: any) {
    console.error('Error fetching products:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

// POST /api/products - Create a new product (admin only)
export async function POST(request: NextRequest) {
  try {
    if (!await isAuthorized()) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectToDatabase();
    const data = await request.json();
    if (data?.category) {
      const isObjectId = typeof data.category === 'string' && /^[a-f\d]{24}$/i.test(data.category);
      if (!isObjectId) {
        const categoryDoc = await Category.findOne({
          $or: [{ slug: data.category }, { name: data.category }]
        });
        if (categoryDoc) {
          data.category = categoryDoc._id;
        }
      }
    }

    if (!data?.category || (typeof data.category === 'string' && !/^[a-f\d]{24}$/i.test(data.category))) {
      return NextResponse.json(
        { success: false, error: 'Category is required' },
        { status: 400 }
      );
    }

    const { Product } = await import('../../../lib/models/product.model');
    
    const product = new Product(data);
    await product.save();
    
    return NextResponse.json({ success: true, product }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating product:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
