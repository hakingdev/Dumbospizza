import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../lib/models';
import { getCategories } from '../../../lib/db/utils';
import { Category } from '../../../lib/models/category.model';
import { getMewsPosEnabled } from '../../../lib/settings';
import { fetchMewsPosCategories } from '../../../lib/mews-pos/sync';
import { getServerSession } from 'next-auth';
import { authOptions, isStaff } from '../../../lib/auth';

async function isAuthorized() {
  const session = await getServerSession(authOptions);
  return isStaff(session);
}

// GET /api/categories - Get all categories
export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    
    const { searchParams } = request.nextUrl;
    const active = searchParams.get('active');
    const source = searchParams.get('source');
    
    const mewsEnabled = source === 'mews' || (source !== 'local' && await getMewsPosEnabled());

    const categories = mewsEnabled
      ? await fetchMewsPosCategories()
      : await getCategories({
          active: active ? active === 'true' : undefined
        });
    
    return NextResponse.json({ success: true, categories });
  } catch (error: any) {
    console.error('Error fetching categories:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

// POST /api/categories - Create a new category (admin only)
export async function POST(request: NextRequest) {
  try {
    if (!await isAuthorized()) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectToDatabase();
    const data = await request.json();
    
    // Create slug from name if not provided
    if (!data.slug && data.name) {
      data.slug = data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }
    
    const category = new Category(data);
    await category.save();
    
    return NextResponse.json({ success: true, category }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating category:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
