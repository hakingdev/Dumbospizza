import Stripe from 'stripe';
import { IOrder } from './models/order.model';
import { getSetting } from './settings';

const stripeCache = new Map<string, Stripe>();

async function getStripeClient() {
  const settings = await getSetting<Record<string, any>>('storeSettings', {});
  const secretKey = settings?.stripeSecretKey || process.env.STRIPE_SECRET_KEY || '';
  if (!secretKey) {
    throw new Error('Stripe secret key is not configured');
  }
  if (!stripeCache.has(secretKey)) {
    stripeCache.set(secretKey, new Stripe(secretKey, { apiVersion: '2023-10-16' }));
  }
  return stripeCache.get(secretKey)!;
}

/**
 * Creates a payment intent for an order
 * @param order Order data
 * @returns Payment intent object
 */
export async function createPaymentIntent(order: IOrder) {
  try {
    const stripe = await getStripeClient();
    // Convert amount to cents (Stripe works with smallest currency unit)
    const amountInCents = Math.round(order.total * 100);
    
    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'eur',
      description: `Order #${order.orderNumber}`,
      metadata: {
        orderId: (order as { _id?: { toString(): string } })._id?.toString(),
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        phoneNumber: order.phoneNumber,
      },
      // Enable Apple Pay and Google Pay
      payment_method_types: ['card', 'apple_pay', 'google_pay'],
      automatic_payment_methods: {
        enabled: true,
      },
    });
    
    return { 
      success: true, 
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    };
  } catch (error: any) {
    console.error('Error creating payment intent:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Confirms a payment was successful
 * @param paymentIntentId The ID of the payment intent to confirm
 * @returns Confirmation result
 */
export async function confirmPayment(paymentIntentId: string) {
  try {
    const stripe = await getStripeClient();
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    if (paymentIntent.status === 'succeeded') {
      return { 
        success: true, 
        paymentIntent 
      };
    } else {
      return { 
        success: false, 
        status: paymentIntent.status 
      };
    }
  } catch (error: any) {
    console.error('Error confirming payment:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Handles the webhook events from Stripe
 * @param event The webhook event from Stripe
 */
export async function handleStripeWebhook(event: Stripe.Event) {
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      // Update order payment status in the database
      // This would be handled in a separate function that updates the order
      console.log('Payment succeeded for order:', paymentIntent.metadata.orderNumber);
      return { success: true };
    }
    
    case 'payment_intent.payment_failed': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      // Handle payment failure
      console.log('Payment failed for order:', paymentIntent.metadata.orderNumber);
      return { success: false };
    }
    
    default:
      // Handle other event types or ignore them
      return { success: true, ignored: true };
  }
}

/**
 * Creates a Stripe checkout session for a one-time payment
 * @param order Order data
 * @param successUrl URL to redirect to on successful payment
 * @param cancelUrl URL to redirect to if payment is cancelled
 */
export async function createCheckoutSession(
  order: IOrder,
  successUrl: string,
  cancelUrl: string
) {
  try {
    const stripe = await getStripeClient();
    const lineItems = order.items.map(item => {
      // Format item name with customizations for display
      let itemName = item.name;
      
      // Add size if exists
      if (item.size) {
        itemName += ` (${item.size.name})`;
      }
      
      // Toppings and other extras as description
      let description = '';

      if (item.extras?.toppings?.length) {
        description += 'Toppings: ' + item.extras.toppings.map(t => t.name).join(', ');
      }

      if (item.extras?.sauces?.length) {
        if (description) description += '; ';
        description += 'Sauce: ' + item.extras.sauces.map(s => s.name).join(', ');
      }
      
      return {
        price_data: {
          currency: 'eur',
          product_data: {
            name: itemName,
            description: description || undefined,
          },
          unit_amount: Math.round(item.totalPrice / item.quantity * 100), // Price per unit in cents
        },
        quantity: item.quantity,
      };
    });
    
    // Add delivery fee if applicable
    if (order.deliveryFee > 0) {
      lineItems.push({
        price_data: {
          currency: 'eur',
          product_data: {
            name: 'Delivery Fee',
            description: 'Delivery fee',
          },
          unit_amount: Math.round(order.deliveryFee * 100),
        },
        quantity: 1,
      });
    }
    
    const session = await stripe.checkout.sessions.create({
      line_items: lineItems,
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        orderId: (order as { _id?: { toString(): string } })._id?.toString(),
        orderNumber: order.orderNumber,
      },
    } as any);
    
    return { 
      success: true, 
      sessionId: session.id,
      url: session.url,
    };
  } catch (error: any) {
    console.error('Error creating checkout session:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}
