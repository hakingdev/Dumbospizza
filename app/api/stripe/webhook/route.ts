import Stripe from 'stripe';
import { headers } from 'next/headers';
import { handleStripeWebhook } from '../../../../lib/payment';
import { connectToDatabase } from '../../../../lib/models';
import { getSetting } from '../../../../lib/settings';

async function getStripeConfig() {
  await connectToDatabase();
  const settings = await getSetting<Record<string, any>>('storeSettings', {});
  return {
    secretKey: settings?.stripeSecretKey || process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: settings?.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET || ''
  };
}

export async function POST(request: Request) {
  const signature = headers().get('stripe-signature');
  const { secretKey, webhookSecret } = await getStripeConfig();

  if (!signature || !webhookSecret || !secretKey) {
    return Response.json(
      { success: false, error: 'Missing Stripe webhook configuration' },
      { status: 400 }
    );
  }

  const body = await request.text();

  try {
    const stripe = new Stripe(secretKey, { apiVersion: '2023-10-16' });
    const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    const result = await handleStripeWebhook(event);
    return Response.json({ success: true, result });
  } catch (error: any) {
    console.error('Stripe webhook error:', error);
    return Response.json(
      { success: false, error: error.message || 'Webhook error' },
      { status: 400 }
    );
  }
}

