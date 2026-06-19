import { NextRequest, NextResponse } from 'next/server';
import { processTelegramUpdate } from '../../../../lib/telegram';
import { connectToDatabase } from '../../../../lib/models';
import { getSetting } from '../../../../lib/settings';

async function getWebhookSecret() {
  await connectToDatabase();
  const settings = await getSetting<Record<string, any>>('storeSettings', {});
  return settings?.telegramWebhookSecret || process.env.TELEGRAM_WEBHOOK_SECRET || '';
}

export async function POST(request: NextRequest) {
  try {
    // Verify the request is from Telegram using the secret token
    const telegramToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    const secretToken = await getWebhookSecret();

    if (!secretToken) {
      return NextResponse.json(
        { success: false, error: 'Telegram webhook secret is not configured' },
        { status: 503 }
      );
    }
    
    if (telegramToken !== secretToken) {
      console.error('Invalid Telegram webhook token');
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    // Parse the incoming update
    const update = await request.json();
    
    // Process the update
    await processTelegramUpdate(update);
    
    // Return success
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error processing Telegram webhook:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
