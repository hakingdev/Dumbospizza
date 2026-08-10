import { getSetting, setSetting } from '../settings';
import { normalizeGermanPhone } from './phone';

/**
 * Suppression-Liste для SMS-маркетинга: номера, отозвавшие согласие через
 * /sms-abmelden. Рассылка и список получателей вычитают эти номера
 * автоматически (согласие с checkout остаётся в заказах нетронутым — тут
 * только отзыв, с датой для документирования по DSGVO).
 *
 * Хранение — Settings (key-value), как и прочие флаги: объёмы — десятки
 * номеров, пишется редко, отдельная таблица (и ручной DDL на проде) не нужна.
 * Read-modify-write без транзакции: гонка двух одновременных отписок
 * теоретически возможна и на этом масштабе приемлема.
 */

interface SmsUnsubscribeEntry {
  phone: string;
  /** ISO-дата отзыва согласия. */
  at: string;
  source?: string;
}

const SETTINGS_KEY = 'smsUnsubscribes';

async function readEntries(): Promise<SmsUnsubscribeEntry[]> {
  const raw = await getSetting<unknown>(SETTINGS_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e) => (typeof e === 'string' ? { phone: e, at: '' } : (e as SmsUnsubscribeEntry)))
    .filter((e): e is SmsUnsubscribeEntry => Boolean(e) && typeof e.phone === 'string');
}

/** Идемпотентно добавляет номер в список отписок. false = номер невалиден. */
export async function addSmsUnsubscribe(rawPhone: string, source = 'web-form'): Promise<boolean> {
  const phone = normalizeGermanPhone(rawPhone);
  if (!phone) return false;

  const entries = await readEntries();
  if (entries.some((e) => normalizeGermanPhone(e.phone) === phone)) return true;

  entries.push({ phone, at: new Date().toISOString(), source });
  await setSetting(SETTINGS_KEY, entries);
  return true;
}

/** Множество отписанных номеров (E.164) для фильтрации получателей. */
export async function getSmsUnsubscribeSet(): Promise<Set<string>> {
  const entries = await readEntries();
  const set = new Set<string>();
  for (const e of entries) {
    const phone = normalizeGermanPhone(e.phone);
    if (phone) set.add(phone);
  }
  return set;
}
