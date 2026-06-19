import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../lib/models';
import { LoyaltyProgram } from '../../../lib/models/loyalty.model';
import { User } from '../../../lib/models/user.model';
import { getLoyaltyByPhone } from '../../../lib/loyalty';
import { getServerSession } from 'next-auth';
import { authOptions, isAdmin } from '../../../lib/auth';

// GET /api/loyalty - Get loyalty program info by phone number
export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    
    const { searchParams } = request.nextUrl;
    const phoneNumber = searchParams.get('phoneNumber');
    
    if (!phoneNumber) {
      return NextResponse.json({ 
        success: false, 
        error: 'Phone number is required' 
      }, { status: 400 });
    }
    
    // Get loyalty program for the phone number
    const loyalty = await getLoyaltyByPhone(phoneNumber);
    
    if (!loyalty) {
      return NextResponse.json({ 
        success: false, 
        error: 'No loyalty program found for this phone number',
        notFound: true
      }, { status: 404 });
    }
    
    const session = await getServerSession(authOptions);
    const canReadTransactions = Boolean(session && isAdmin(session));

    return NextResponse.json({
      success: true,
      loyalty: {
        phoneNumber: loyalty.phoneNumber,
        balance: loyalty.balance,
        totalEarned: loyalty.totalEarned,
        totalRedeemed: loyalty.totalRedeemed,
        ...(canReadTransactions ? { transactions: loyalty.transactions.slice(0, 10) } : {})
      }
    });
  } catch (error: any) {
    console.error('Error fetching loyalty program:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

// POST /api/loyalty - Create or update loyalty program
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    
    const data = await request.json();
    const { phoneNumber, userId } = data;
    
    if (!phoneNumber) {
      return NextResponse.json({ 
        success: false, 
        error: 'Phone number is required' 
      }, { status: 400 });
    }
    
    // Check if loyalty program already exists
    let loyalty = await LoyaltyProgram.findOne({ phoneNumber });
    
    if (loyalty) {
      return NextResponse.json({ 
        success: false, 
        error: 'Loyalty program already exists for this phone number' 
      }, { status: 400 });
    }
    
    // Find or create user if userId not provided
    let user;
    if (userId) {
      user = await User.findById(userId);
      if (!user) {
        return NextResponse.json({ 
          success: false, 
          error: 'User not found' 
        }, { status: 404 });
      }
    } else {
      user = await User.findOne({ phoneNumber });
      
      // If user not found, create a new one
      if (!user) {
        user = new User({
          name: data.name || 'Customer',
          phoneNumber,
          role: 'customer'
        });
        await user.save();
      }
    }
    
    // Create new loyalty program
    loyalty = new LoyaltyProgram({
      user: user._id,
      phoneNumber,
      balance: 0,
      totalEarned: 0,
      totalRedeemed: 0,
      transactions: []
    });
    
    await loyalty.save();
    
    return NextResponse.json({
      success: true,
      loyalty: {
        phoneNumber: loyalty.phoneNumber,
        balance: loyalty.balance,
        totalEarned: loyalty.totalEarned,
        totalRedeemed: loyalty.totalRedeemed
      },
      user: {
        id: user._id,
        name: user.name,
        phoneNumber: user.phoneNumber
      }
    }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating loyalty program:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
