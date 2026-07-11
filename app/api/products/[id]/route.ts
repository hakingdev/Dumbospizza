import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { Product } from '../../../../lib/models/product.model';
import { Category } from '../../../../lib/models/category.model';
// регистрация моделей для populate групп опций
import '../../../../lib/models/option-group.model';
import '../../../../lib/models/option.model';
import { getMewsPosEnabled } from '../../../../lib/settings';
import { fetchMewsPosProductById } from '../../../../lib/mews-pos/sync';
import { getServerSession } from 'next-auth';
import { authOptions, isStaff } from '../../../../lib/auth';
import { toRefId } from '../../../../lib/normalize-id';
import { sanitizeProductInput } from '../../../../lib/products/sanitize';
import { hydrateSizeVariationStates } from '../../../../lib/size-variation-sync';

async function isAuthorized() {
  const session = await getServerSession(authOptions);
  return isStaff(session);
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await connectToDatabase();
    const source = request.nextUrl.searchParams.get('source');
    const mewsEnabled = source === 'mews' || (source !== 'local' && await getMewsPosEnabled());

    const product = mewsEnabled
      ? await fetchMewsPosProductById(params.id)
      : await Product.findById(params.id)
          .populate('category')
          .populate({ path: 'optionGroupIds', strictPopulate: false, populate: { path: 'optionIds', strictPopulate: false } });
    
    if (!product) {
      return NextResponse.json({ 
        success: false, 
        error: 'Product not found' 
      }, { status: 404 });
    }
    
    const [hydratedProduct] = await hydrateSizeVariationStates([product as any]);
    return NextResponse.json({ success: true, product: hydratedProduct });
  } catch (error: any) {
    console.error('Error fetching product:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (!await isAuthorized()) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectToDatabase();
    // Форма редактирования шлёт весь товар назад (вкл. _id/createdAt/updatedAt) —
    // убираем иммутабельные поля и нормализуем taxRate, иначе update падает с 500.
    const data = sanitizeProductInput(await request.json());

    // GET отдаёт category/optionGroupIds через .populate() ОБЪЕКТАМИ, форма шлёт их
    // обратно как есть. Без нормализации объект попадает в SQL/колонку → 500.
    if (data?.category != null) {
      const cat = toRefId(data.category);
      if (!cat) {
        delete data.category;
      } else if (/^[a-f\d]{24}$/i.test(cat)) {
        data.category = cat;
      } else {
        // строка-слаг/имя → ищем категорию
        const categoryDoc = await Category.findOne({ $or: [{ slug: cat }, { name: cat }] });
        data.category = categoryDoc ? String(categoryDoc._id) : cat;
      }
    }

    if (Array.isArray(data?.optionGroupIds)) {
      data.optionGroupIds = data.optionGroupIds.map(toRefId).filter(Boolean);
    }


    const product = await Product.findByIdAndUpdate(
      params.id,
      data,
      { new: true, runValidators: true }
    );
    
    if (!product) {
      return NextResponse.json({ 
        success: false, 
        error: 'Product not found' 
      }, { status: 404 });
    }
    
    return NextResponse.json({ success: true, product });
  } catch (error: any) {
    console.error('Error updating product:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (!await isAuthorized()) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectToDatabase();
    const product = await Product.findByIdAndDelete(params.id);
    
    if (!product) {
      return NextResponse.json({ 
        success: false, 
        error: 'Product not found' 
      }, { status: 404 });
    }
    
    return NextResponse.json({ success: true, message: 'Product deleted' });
  } catch (error: any) {
    console.error('Error deleting product:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
