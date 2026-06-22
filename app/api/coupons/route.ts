import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../lib/models';
import { Coupon } from '../../../lib/models/coupon.model';
import { isAdmin, isStaff } from '../../../lib/auth';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth';
import {
  isCouponCurrentlyValid,
  normalizeCouponCode,
  type CouponInvalidReason,
} from '../../../lib/promotions/coupon-validity';

/** HTTP-статус по причине невалидности (единый для всех точек). */
const STATUS_BY_REASON: Record<CouponInvalidReason, number> = {
  not_found: 404,
  inactive: 404,
  not_started: 400,
  expired: 400,
  usage_limit: 400,
  min_order: 400,
};

/** Стабильный человекочитаемый текст (UI выбирает текст по reason, не по строке). */
const MESSAGE_BY_REASON: Record<CouponInvalidReason, string> = {
  not_found: 'Coupon not found',
  inactive: 'Coupon inactive',
  not_started: 'Coupon not yet active',
  expired: 'Coupon expired',
  usage_limit: 'Coupon usage limit reached',
  min_order: 'Minimum order amount not met',
};

// GET /api/coupons - Get all coupons (admin) or validate a coupon (customer)
export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    
    const { searchParams } = request.nextUrl;
    const code = searchParams.get('code');
    const orderAmount = searchParams.get('orderAmount') 
      ? parseFloat(searchParams.get('orderAmount')!) 
      : undefined;
    
    // Запрос на проверку конкретного купона
    if (code) {
      // Ищем строго по коду (без date-фильтра в запросе!): валидность — через единый
      // helper, иначе date-only validTo «истекает» в начале дня (полночь UTC).
      const coupon = await Coupon.findOne({ code: normalizeCouponCode(code) });

      const validity = isCouponCurrentlyValid(coupon as any, new Date(), orderAmount);
      if (!validity.valid) {
        const reason = validity.reason!;
        return NextResponse.json(
          { success: false, error: MESSAGE_BY_REASON[reason], reason },
          { status: STATUS_BY_REASON[reason] }
        );
      }

      // Вычисляем скидку, если указана сумма заказа
      let discount = undefined;
      if (orderAmount !== undefined) {
        if (coupon.discountType === 'fixed') {
          discount = Math.min(coupon.discountValue, orderAmount);
        } else {
          // Процентная скидка
          discount = Math.min(orderAmount * (coupon.discountValue / 100), orderAmount);
        }
      }
      
      return NextResponse.json({
        success: true,
        coupon: {
          code: coupon.code,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue,
          minOrderAmount: coupon.minOrderAmount,
          discount
        }
      });
    }
    
    // Для администраторов - список всех купонов
    const session = await getServerSession(authOptions);
    if (!session || !isStaff(session)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Unauthorized access' 
      }, { status: 401 });
    }
    
    const coupons = await Coupon.find().sort({ createdAt: -1 });
    
    return NextResponse.json({
      success: true,
      coupons
    });
  } catch (error: any) {
    console.error('Error fetching coupons:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

// POST /api/coupons - Create a new coupon (admin only)
export async function POST(request: NextRequest) {
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
    
    // Валидация данных
    if (!data.code || !data.discountType || data.discountValue === undefined) {
      return NextResponse.json({
        success: false,
        error: 'Required fields missing: code, discountType, discountValue'
      }, { status: 400 });
    }
    
    // Проверка на дублирование кода
    const existingCoupon = await Coupon.findOne({ code: data.code.toUpperCase() });
    if (existingCoupon) {
      return NextResponse.json({
        success: false,
        error: `Coupon with code ${data.code} already exists`
      }, { status: 409 });
    }
    
    // Нормализация дат
    if (data.validFrom) data.validFrom = new Date(data.validFrom);
    if (data.validTo) data.validTo = new Date(data.validTo);
    
    // Создание нового купона
    const newCoupon = await Coupon.create({
      ...data,
      code: data.code.toUpperCase(),
      usageCount: 0
    });
    
    return NextResponse.json({
      success: true,
      coupon: newCoupon
    }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating coupon:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
