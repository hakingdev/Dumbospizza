import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../lib/models';
import { User } from '../../../lib/models/user.model';
import bcrypt from 'bcryptjs';
import { isAdmin } from '../../../lib/auth';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth';

// GET /api/users - Get all users (admin only)
export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    
    // Check admin authorization
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Unauthorized access' 
      }, { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const role = searchParams.get('role');
    const phoneNumber = searchParams.get('phoneNumber');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const skip = (page - 1) * limit;
    
    // Build query
    const query: any = {};
    
    if (role) {
      query.role = role;
    }
    
    if (phoneNumber) {
      query.phoneNumber = phoneNumber;
    }
    
    // Get users with pagination
    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    
    const total = await User.countDocuments(query);
    
    return NextResponse.json({
      success: true,
      users,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    console.error('Error fetching users:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

// POST /api/users - Create a new user (customer registration)
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    
    const data = await request.json();
    const { name, email, phoneNumber, password } = data;
    
    // Check if user already exists with this email or phone
    if (email) {
      const existingUserByEmail = await User.findOne({ email });
      if (existingUserByEmail) {
        return NextResponse.json({ 
          success: false, 
          error: 'Email already registered' 
        }, { status: 400 });
      }
    }
    
    const existingUserByPhone = await User.findOne({ phoneNumber });
    if (existingUserByPhone) {
      return NextResponse.json({ 
        success: false, 
        error: 'Phone number already registered' 
      }, { status: 400 });
    }
    
    // Create user with hashed password if provided
    const userData: any = {
      name,
      phoneNumber,
      role: 'customer'
    };
    
    if (email) {
      userData.email = email;
    }
    
    if (password) {
      const salt = await bcrypt.genSalt(10);
      userData.password = await bcrypt.hash(password, salt);
    }
    
    const user = new User(userData);
    await user.save();
    
    // Don't return password in response
    const userResponse = user.toObject();
    delete userResponse.password;
    
    return NextResponse.json({
      success: true,
      user: userResponse
    }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating user:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
