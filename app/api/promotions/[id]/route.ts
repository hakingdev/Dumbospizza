import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { connectToDatabase } from '../../../../lib/models';
import { Promotion } from '../../../../lib/models/promotion.model';
import { authOptions, isStaff } from '../../../../lib/auth';
import { toPromotionAdminView, toPromotionPublicView } from '../../../../lib/promotions/serialize';
import {
  formatPromotionSaveError,
  sanitizePromotionPayload,
} from '../../../../lib/promotions/sanitize-payload';

type RouteParams = { params: { id: string } };

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await connectToDatabase();
    const admin = request.nextUrl.searchParams.get('admin') === '1';
    const session = await getServerSession(authOptions);
    const promo = await Promotion.findById(params.id);
    if (!promo) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    if (admin) {
      if (!session || !isStaff(session)) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
      return NextResponse.json({ success: true, promotion: toPromotionAdminView(promo) });
    }
    return NextResponse.json({ success: true, promotion: toPromotionPublicView(promo) });
  } catch (error) {
    console.error('GET /api/promotions/[id]', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch promotion' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session || !isStaff(session)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const update = sanitizePromotionPayload(body);
    if (body.validFrom) update.validFrom = new Date(body.validFrom);
    if (body.validTo) update.validTo = new Date(body.validTo);

    const promo = await Promotion.findByIdAndUpdate(params.id, update, {
      new: true,
      runValidators: true,
    });
    if (!promo) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, promotion: toPromotionAdminView(promo) });
  } catch (error) {
    console.error('PUT /api/promotions/[id]', error);
    const { message, status } = formatPromotionSaveError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session || !isStaff(session)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const promo = await Promotion.findByIdAndDelete(params.id);
    if (!promo) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/promotions/[id]', error);
    return NextResponse.json({ success: false, error: 'Failed to delete promotion' }, { status: 500 });
  }
}
