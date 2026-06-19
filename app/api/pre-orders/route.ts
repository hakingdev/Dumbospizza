import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../lib/models';
import { sendPreOrderNotification } from '../../../lib/telegram';
import { PreOrder } from '../../../lib/models/pre-order.model';

export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();

    const data = await request.json();

    // Validate required fields
    if (!data.name || !data.phone || !data.address) {
      return NextResponse.json(
        { success: false, error: 'Name, Telefon und Adresse sind erforderlich' },
        { status: 400 }
      );
    }

    // Create pre-order
    const preOrder = new PreOrder({
      name: data.name.trim(),
      phone: data.phone.trim(),
      address: data.address.trim(),
      email: data.email ? data.email.trim() : undefined
    });

    await preOrder.save();

    // Отправить в тот же Telegram-чат (предзаказ)
    await sendPreOrderNotification({
      name: preOrder.name,
      phone: preOrder.phone,
      address: preOrder.address,
      email: preOrder.email
    }).catch((err) => console.error('Pre-order Telegram:', err));

    return NextResponse.json({ success: true, preOrder }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating pre-order:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Fehler beim Speichern der Anfrage' },
      { status: 500 }
    );
  }
}

