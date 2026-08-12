import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { getAdminDashboardStats, getDailySales } from '../../../../lib/db/utils';
import { isStaff } from '../../../../lib/auth';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/admin/stats - Get admin dashboard statistics
export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session || !isStaff(session)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Unauthorized access' 
      }, { status: 401 });
    }
    
    // Get basic dashboard stats
    const stats = await getAdminDashboardStats();

    // Sales data window: default one week, ?days=14 lets the portal
    // compare the current week against the previous one
    const daysParam = Number(request.nextUrl.searchParams.get('days'));
    const days = Number.isFinite(daysParam) ? Math.min(90, Math.max(1, Math.trunc(daysParam))) : 7;
    const salesData = await getDailySales(days);
    
    return NextResponse.json({
      success: true,
      stats,
      salesData
    });
  } catch (error: any) {
    console.error('Error fetching admin stats:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
