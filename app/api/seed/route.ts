import { NextRequest, NextResponse } from 'next/server';
import { seedDatabase } from '../../../lib/seed-data';

// This route should only be available in development
// GET or POST /api/seed - Seed the database with initial data

// Общая функция для обработки запросов сидирования базы
async function handleSeedRequest(request: NextRequest) {
  try {
    // Check if we're in development mode
    const nodeEnv = process.env.NODE_ENV;
    const seedKey = process.env.SEED_SECRET_KEY || 'development_seed_key';
    
    if (nodeEnv !== 'development') {
      return NextResponse.json({ 
        success: false, 
        error: 'This route is only available in development mode' 
      }, { status: 403 });
    }
    
    // Check for a secret key to prevent unauthorized seeding
    const { searchParams } = request.nextUrl;
    const secretKey = searchParams.get('key');
    
    if (!secretKey || secretKey !== seedKey) {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid or missing secret key' 
      }, { status: 401 });
    }
    
    // Seed the database
    const result = await seedDatabase();
    
    if (result.success) {
      return NextResponse.json({ 
        success: true, 
        message: 'Database seeded successfully' 
      });
    } else {
      throw result.error;
    }
  } catch (error: any) {
    console.error('Error seeding database:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

// Обработка GET-запроса (из браузера)
export async function GET(request: NextRequest) {
  return handleSeedRequest(request);
}

// Обработка POST-запроса (из API-клиента)
export async function POST(request: NextRequest) {
  return handleSeedRequest(request);
}
