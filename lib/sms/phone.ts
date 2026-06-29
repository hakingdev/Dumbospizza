/**
 * Нормализация номеров телефона в формат E.164 (по умолчанию для Германии, +49).
 * Нужна и для чистого списка SMS-получателей, и для будущей отправки через Brevo
 * (которая требует международный формат +49…).
 */

const DEFAULT_COUNTRY_CODE = '49'; // Германия

/**
 * Приводит «сырой» номер к виду +49XXXXXXXXX или возвращает null, если номер
 * не похож на валидный мобильный/телефонный (слишком короткий/длинный/мусор).
 */
export function normalizeGermanPhone(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  let s = String(raw).trim();
  if (!s) return null;

  // Убираем всё кроме цифр и ведущего «+».
  const hadPlus = s.startsWith('+');
  let digits = s.replace(/[^\d]/g, '');

  if (hadPlus) {
    // уже международный: +<digits>
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2); // 0049… → 49…
  } else if (digits.startsWith('0')) {
    digits = DEFAULT_COUNTRY_CODE + digits.slice(1); // 0151… → 49151…
  } else if (!digits.startsWith(DEFAULT_COUNTRY_CODE)) {
    digits = DEFAULT_COUNTRY_CODE + digits; // локальный без 0
  }

  // E.164: 8–15 цифр всего.
  if (digits.length < 8 || digits.length > 15) return null;

  return `+${digits}`;
}

export interface ParsedPhoneRecipients {
  recipients: string[];
  invalidEntries: string[];
  duplicateCount: number;
}

/** Парсит список номеров (массив или строка через перевод строки/запятую/`;`). */
export function parsePhoneRecipients(
  input: string | Array<string | number>
): ParsedPhoneRecipients {
  const rawEntries = Array.isArray(input)
    ? input.map((e) => String(e))
    : input.split(/[\n,;]+/);

  const recipients: string[] = [];
  const invalidEntries: string[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;

  for (const raw of rawEntries) {
    const entry = raw.trim();
    if (!entry) continue;
    const phone = normalizeGermanPhone(entry);
    if (!phone) {
      invalidEntries.push(entry);
      continue;
    }
    if (seen.has(phone)) {
      duplicateCount++;
      continue;
    }
    seen.add(phone);
    recipients.push(phone);
  }

  return { recipients, invalidEntries, duplicateCount };
}
