import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { getSetting, setSetting } from '../../../../lib/settings';
import { getServerSession } from 'next-auth';
import { authOptions, isAdmin } from '../../../../lib/auth';

const PUBLIC_SETTING_KEYS = [
  'storeName',
  'phone',
  'email',
  'address',
  'currency',
  'minOrderAmount',
  'deliveryTime',
  'deliverySlotStart',
  'deliverySlotEnd',
  'deliverySlotStepMinutes',
  'ordersStartHour',
  'ordersEndHour',
  'ordersTimeZone',
  'ordersClosedReason',
  'ordersClosedMessageBeforeOpen',
  'ordersClosedMessageAfterClose',
  'ordersBlockedUntil',
  'ordersBlockedReason',
  'ordersBlockMinutes',
  'stripePublicKey',
  'metaTitle',
  'metaDescription',
  'metaKeywords',
  'contactEmail',
  'supportPhone',
  'whatsapp',
  'facebook',
  'instagram',
  'telegram',
] as const;

async function isAuthorized() {
  const session = await getServerSession(authOptions);
  return isAdmin(session);
}

function toPublicSettings(settings: Record<string, any>) {
  return PUBLIC_SETTING_KEYS.reduce<Record<string, any>>((publicSettings, key) => {
    if (settings[key] !== undefined) {
      publicSettings[key] = settings[key];
    }
    return publicSettings;
  }, {});
}

export async function GET() {
  try {
    const authorized = await isAuthorized();
    await connectToDatabase();
    const settings = await getSetting<Record<string, any>>('storeSettings', {});
    return NextResponse.json({
      success: true,
      settings: authorized ? settings || {} : toPublicSettings(settings || {}),
    });
  } catch (error: any) {
    console.error('Error reading store settings:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!await isAuthorized()) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectToDatabase();
    const data = await request.json();
    await setSetting('storeSettings', data || {});
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error saving store settings:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
