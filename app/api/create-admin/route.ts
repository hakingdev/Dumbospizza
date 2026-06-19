import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../lib/models';
import { User } from '../../../lib/models/user.model';

async function createAdminUser(request: NextRequest) {
  try {
    await connectToDatabase();
    
    const { searchParams } = request.nextUrl;
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const isProduction = process.env.NODE_ENV === 'production';
    const secretKey = body.key || request.headers.get('x-admin-key') || (!isProduction ? searchParams.get('key') : null);
    const requestedEmail = body.email || (!isProduction ? searchParams.get('email') : null) || 'admin@dumbospizza.de';
    const requestedPassword = body.password || (!isProduction ? searchParams.get('password') : null) || '';
    const requestedPhone = body.phone || (!isProduction ? searchParams.get('phone') : null) || '+491234567890';
    const forceUpdate = body.force === true || (!isProduction && searchParams.get('force') === '1');
    const configuredSecret = process.env.SEED_SECRET_KEY;
    
    // Проверка секретного ключа
    if (!configuredSecret) {
      return NextResponse.json({
        success: false,
        error: 'Admin creation secret is not configured'
      }, { status: 503 });
    }

    if (secretKey !== configuredSecret) {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid secret key' 
      }, { status: 401 });
    }

    if (!requestedPassword && isProduction) {
      return NextResponse.json({
        success: false,
        error: 'Password is required'
      }, { status: 400 });
    }

    const password = requestedPassword || 'admin123';
    
    // Проверяем, существует ли уже админ
    const existingAdmin = await User.findOne({ role: 'admin' });
    if (existingAdmin) {
      if (!forceUpdate) {
        return NextResponse.json({ 
          success: true, 
          message: 'Admin already exists',
          email: existingAdmin.email
        });
      }
      
      existingAdmin.email = requestedEmail;
      existingAdmin.phoneNumber = requestedPhone;
      existingAdmin.password = password;
      existingAdmin.role = 'admin';
      existingAdmin.isVerified = true;
      existingAdmin.name = existingAdmin.name || 'Admin';
      await existingAdmin.save();
      
      return NextResponse.json({ 
        success: true, 
        message: 'Admin updated successfully',
        email: requestedEmail,
        loginUrl: '/admin/login'
      });
    }
    
    // Создаем админа
    const admin = new User({
      email: requestedEmail,
      phoneNumber: requestedPhone,
      password,
      role: 'admin',
      isVerified: true,
      name: 'Admin'
    });
    
    await admin.save();
    
    return NextResponse.json({ 
      success: true, 
      message: 'Admin created successfully',
      email: requestedEmail,
      loginUrl: '/admin/login'
    });
  } catch (error: any) {
    console.error('Error creating admin:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { success: false, error: 'GET is disabled in production' },
      { status: 405 }
    );
  }

  return createAdminUser(request);
}

export async function POST(request: NextRequest) {
  return createAdminUser(request);
}
