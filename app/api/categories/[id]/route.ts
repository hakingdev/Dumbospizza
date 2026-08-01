import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { Category } from '../../../../lib/models/category.model';
import { Product } from '../../../../lib/models/product.model';
import { getServerSession } from 'next-auth';
import { authOptions, isStaff } from '../../../../lib/auth';
import { readSubcategories, sanitizeSubcategories } from '../../../../lib/categories/subcategories';
import { invalidateCategories } from '../../../../lib/db/utils';

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
    const category = await Category.findById(params.id);
    
    if (!category) {
      return NextResponse.json({ success: false, error: 'Category not found' }, { status: 404 });
    }
    
    return NextResponse.json({ success: true, category });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
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

    // Список подкатегорий редактируется целиком: нормализуем и запоминаем,
    // какие метки исчезли — их нужно снять с товаров (иначе висят «осиротевшими»).
    let removedSubcategoryIds: string[] = [];
    if ('subcategories' in data) {
      const previous = await Category.findById(params.id);
      if (!previous) {
        return NextResponse.json({ success: false, error: 'Category not found' }, { status: 404 });
      }
      data.subcategories = sanitizeSubcategories(data.subcategories);
      const kept = new Set(data.subcategories.map((s: { id: string }) => s.id));
      removedSubcategoryIds = readSubcategories(previous)
        .map((s) => s.id)
        .filter((id) => !kept.has(id));
    }

    const category = await Category.findByIdAndUpdate(
      params.id,
      { $set: data },
      { new: true, runValidators: true }
    );

    if (!category) {
      return NextResponse.json({ success: false, error: 'Category not found' }, { status: 404 });
    }

    invalidateCategories();

    if (removedSubcategoryIds.length > 0) {
      await Product.updateMany(
        { category: params.id, subcategoryId: { $in: removedSubcategoryIds } },
        { subcategoryId: null }
      );
    }

    return NextResponse.json({ success: true, category });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
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
    const category = await Category.findByIdAndDelete(params.id);
    
    if (!category) {
      return NextResponse.json({ success: false, error: 'Category not found' }, { status: 404 });
    }

    invalidateCategories();

    return NextResponse.json({ success: true, message: 'Category deleted' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}


