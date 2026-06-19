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
    
    return NextResponse.json({ success: true, product });
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
