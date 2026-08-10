import { CANONICAL_HOST } from '../site-url';

/**
 * Подсчёт SMS-сегментов (тарификация Twilio идёт ПО СЕГМЕНТАМ) и сборка
 * финального текста Werbe-SMS с обязательным Abmelde-Hinweis.
 *
 * Кодировки: если весь текст укладывается в GSM 03.38 → GSM-7 (160 знаков на
 * одиночную SMS, 153 на сегмент при склейке; символы расширенной таблицы —
 * `^{}\[~]|€` — стоят 2 септета). Любой символ вне таблицы (эмодзи, «…», „“)
 * переключает ВСЮ SMS в UCS-2: 70/67 знаков на сегмент. Немецкие äöüß и
 * é/è/à — в базовой таблице, они «бесплатные».
 */

const GSM7_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
);

const GSM7_EXTENDED = new Set('^{}\\[~]|€');

export interface SmsTextInfo {
  encoding: 'GSM-7' | 'UCS-2';
  /** Септеты (GSM-7, extended-символы за 2) или UTF-16 code units (UCS-2). */
  units: number;
  segments: number;
  /** Вместимость одного сегмента при этой кодировке и длине. */
  perSegment: number;
}

export function analyzeSmsText(text: string): SmsTextInfo {
  let gsm = true;
  let septets = 0;
  for (const ch of text) {
    if (GSM7_BASIC.has(ch)) septets += 1;
    else if (GSM7_EXTENDED.has(ch)) septets += 2;
    else {
      gsm = false;
      break;
    }
  }

  if (gsm) {
    const perSegment = septets <= 160 ? 160 : 153;
    const segments = septets === 0 ? 0 : Math.ceil(septets / perSegment);
    return { encoding: 'GSM-7', units: septets, segments, perSegment };
  }

  // UCS-2 считает UTF-16 code units — эмодзи (суррогатная пара) занимает 2.
  const units = text.length;
  const perSegment = units <= 70 ? 70 : 67;
  const segments = units === 0 ? 0 : Math.ceil(units / perSegment);
  return { encoding: 'UCS-2', units, segments, perSegment };
}

/** Публичная страница отписки от Werbe-SMS. */
export const SMS_OPTOUT_PATH = '/sms-abmelden';

/**
 * Abmelde-Hinweis для каждой Werbe-SMS: чекбокс на checkout обещает «Abmeldung
 * jederzeit möglich», а Alphanumeric Sender не принимает ответы (STOP не
 * сработает) — поэтому ссылка обязательна. Без протокола: короче и кликабельно.
 */
export const SMS_OPTOUT_FOOTER = `Abmelden: ${CANONICAL_HOST}${SMS_OPTOUT_PATH}`;

/** Финальный текст SMS: сообщение + Abmelde-Hinweis (если ссылки ещё нет). */
export function composeSmsText(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return '';
  if (trimmed.toLowerCase().includes(SMS_OPTOUT_PATH.slice(1))) return trimmed;
  return `${trimmed}\n${SMS_OPTOUT_FOOTER}`;
}
