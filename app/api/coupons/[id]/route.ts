import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { Coupon } from '../../../../lib/models/coupon.model';
import { isAdmin } from '../../../../lib/auth';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth';

// GET /api/coupons/[id] - Get a specific coupon by ID (admin only)
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await connectToDatabase();
    
    // Проверка авторизации
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Unauthorized access. Admin rights required.' 
      }, { status: 401 });
    }
    
    const coupon = await Coupon.findById(params.id);
    
    if (!coupon) {
      return NextResponse.json({
        success: false,
        error: 'Coupon not found'
      }, { status: 404 });
    }
    
    return NextResponse.json({
      success: true,
      coupon
    });
  } catch (error: any) {
    console.error(`Error fetching coupon ${params.id}:`, error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

// PUT /api/coupons/[id] - Update a coupon (admin only)
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await connectToDatabase();
    
    // Проверка авторизации
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Unauthorized access. Admin rights required.' 
      }, { status: 401 });
    }
    
    const data = await request.json();
    
    // Проверка наличия купона
    const coupon = await Coupon.findById(params.id);
    if (!coupon) {
      return NextResponse.json({
        success: false,
        error: 'Coupon not found'
      }, { status: 404 });
    }
    
    // Проверка на дублирование кода при изменении кода
    if (data.code && data.code !== coupon.code) {
      const existingCoupon = await Coupon.findOne({ 
        code: data.code.toUpperCase(),
        _id: { $ne: params.id }
      });
      
      if (existingCoupon) {
        return NextResponse.json({
          success: false,
          error: `Coupon with code ${data.code} already exists`
        }, { status: 409 });
      }
      
      // Преобразуем код в верхний регистр
      data.code = data.code.toUpperCase();
    }
    
    // Нормализация дат
    if (data.validFrom) data.validFrom = new Date(data.validFrom);
    if (data.validTo) data.validTo = new Date(data.validTo);
    
    // Обновление купона
    const updatedCoupon = await Coupon.findByIdAndUpdate(
      params.id,
      { $set: data },
      { new: true, runValidators: true }
    );
    
    return NextResponse.json({
      success: true,
      coupon: updatedCoupon
    });
  } catch (error: any) {
    console.error(`Error updating coupon ${params.id}:`, error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

// DELETE /api/coupons/[id] - Delete a coupon (admin only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await connectToDatabase();
    
    // Проверка авторизации
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Unauthorized access. Admin rights required.' 
      }, { status: 401 });
    }
    
    // Проверка наличия купона
    const coupon = await Coupon.findById(params.id);
    if (!coupon) {
      return NextResponse.json({
        success: false,
        error: 'Coupon not found'
      }, { status: 404 });
    }
    
    // Удаление купона
    await Coupon.findByIdAndDelete(params.id);
    
    return NextResponse.json({
      success: true,
      message: `Coupon ${coupon.code} has been deleted`
    });
  } catch (error: any) {
    console.error(`Error deleting coupon ${params.id}:`, error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
