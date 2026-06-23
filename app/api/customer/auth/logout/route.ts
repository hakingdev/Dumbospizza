import { NextResponse } from 'next/server';
import { clearCustomerCookie } from '../../../../../lib/customer-auth';

// POST /api/customer/auth/logout — выход (очистка cookie)
export async function POST() {
  const response = NextResponse.json({ success: true });
  return clearCustomerCookie(response);
}
