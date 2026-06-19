import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { getMewsPosEnabled, setMewsPosEnabled } from '../../../../lib/settings';
import { getServerSession } from 'next-auth';
import { authOptions, isAdmin } from '../../../../lib/auth';

async function isAuthorized(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key') || request.headers.get('x-admin-key');
  if (key && key === process.env.SEED_SECRET_KEY) {
    return true;
  }
  const session = await getServerSession(authOptions);
  return isAdmin(session);
}

export async function GET(request: NextRequest) {
  try {
    if (!await isAuthorized(request)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectToDatabase();
    const enabled = await getMewsPosEnabled();
    return NextResponse.json({ success: true, enabled });
  } catch (error: any) {
    console.error('Error reading Mews POS setting:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!await isAuthorized(request)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await connectToDatabase();
    const body = await request.json().catch(() => ({}));
    const enabledParam = request.nextUrl.searchParams.get('enabled');
    const enabled = body.enabled ?? (enabledParam !== null ? enabledParam === 'true' : undefined);

    if (enabled === undefined) {
      return NextResponse.json(
        { success: false, error: 'enabled is required' },
        { status: 400 }
      );
    }

    await setMewsPosEnabled(Boolean(enabled));
    return NextResponse.json({ success: true, enabled: Boolean(enabled) });
  } catch (error: any) {
    console.error('Error updating Mews POS setting:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

