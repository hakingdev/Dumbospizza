import { NextRequest, NextResponse } from 'next/server';
import { isValidPlz, lookupCityByPlz } from '../../../../lib/delivery/plz-city';

export const dynamic = 'force-dynamic';

// GET /api/delivery/plz-city?plz=97688 — город для автоподстановки «Ort» в checkout.
export async function GET(request: NextRequest) {
  const plz = (request.nextUrl.searchParams.get('plz') || '').trim();
  if (!isValidPlz(plz)) {
    return NextResponse.json({ success: false, error: 'Invalid PLZ' }, { status: 400 });
  }

  const city = await lookupCityByPlz(plz);
  if (!city) {
    return NextResponse.json({ success: false }, { status: 404 });
  }

  // PLZ→город практически статичен — пусть CDN держит ответ подольше.
  return NextResponse.json(
    { success: true, city },
    { headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=604800' } }
  );
}
