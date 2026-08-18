import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '../../../../../lib/models';
import { authorizePos } from '../../../../../lib/pos/auth';
import {
  getPosPrintSettings,
  setPosPrintSettings,
  type PosPrintSettings,
} from '../../../../../lib/pos/settings';

export const dynamic = 'force-dynamic';

/**
 * Настройки прибора для экрана «Mehr».
 *
 * До этого настройки печати правились только запросом руками: ключ
 * `posPrintSettings` лежал в базе со значениями по умолчанию, а интерфейса к нему
 * не было нигде — ни в админке, ни на приборе. Меняет их тот, кто стоит у
 * принтера и видит бумагу, поэтому экран здесь, а не в админке.
 */

/** Поля, которые можно править с прибора. */
const EDITABLE: (keyof PosPrintSettings)[] = [
  'enabled',
  'boldBody',
  'bigAccents',
  'copies',
  'feedLines',
  'width',
  'pollMs',
];

export async function GET(request: NextRequest) {
  const auth = await authorizePos(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await connectToDatabase();
    return NextResponse.json(
      {
        success: true,
        settings: await getPosPrintSettings(),
        // Кто вошёл на приборе. Кухня меняется, и вопрос «под кем мы сидим»
        // возникает раньше, чем вопрос про настройки печати.
        signedInAs: auth.caller.kind === 'staff' ? auth.caller.name : null,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: any) {
    console.error('[pos] settings read error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * PATCH — частичное обновление. Значения нормализуются в lib/pos/settings.ts:
 * мусор в ширине строки разъедет весь чек, и границы там жёсткие.
 *
 * Правит только персонал: прибор не должен переписывать собственные настройки —
 * иначе сбой на одном устройстве менял бы печать для всех.
 */
export async function PATCH(request: NextRequest) {
  const auth = await authorizePos(request);
  if (!auth.ok || auth.caller.kind !== 'staff') {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const patch: Partial<PosPrintSettings> = {};
    for (const key of EDITABLE) {
      if (body?.[key] !== undefined) (patch as any)[key] = body[key];
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: false, error: 'Nichts zu ändern' }, { status: 400 });
    }

    await connectToDatabase();
    const settings = await setPosPrintSettings(patch);
    console.log(`[pos] settings changed by=${auth.caller.name}: ${Object.keys(patch).join(', ')}`);
    return NextResponse.json({ success: true, settings });
  } catch (error: any) {
    console.error('[pos] settings write error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
