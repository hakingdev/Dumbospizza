import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../lib/models';
import { addSmsUnsubscribe } from '../../../../lib/sms/suppression';

export const dynamic = 'force-dynamic';

/**
 * Публичная отписка от Werbe-SMS: форма на /sms-abmelden шлёт сюда номер.
 * Идемпотентно; ответ не раскрывает, был ли номер в базе. Токен не требуем —
 * ссылка в SMS должна быть короткой, а «вред» от чужой отписки минимален.
 */
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const phone = typeof body.phone === 'string' ? body.phone : '';

    const ok = await addSmsUnsubscribe(phone, 'web-form');
    if (!ok) {
      return NextResponse.json(
        { success: false, error: 'Bitte eine gültige Telefonnummer eingeben.' },
        { status: 400 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('POST /api/sms/unsubscribe', error);
    return NextResponse.json(
      { success: false, error: 'Die Abmeldung konnte nicht verarbeitet werden.' },
      { status: 500 }
    );
  }
}
