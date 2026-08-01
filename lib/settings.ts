import Settings from './models/settings.model';
import { createTtlCache } from './cache/ttl-cache';

export async function getSetting<T>(key: string, fallback?: T): Promise<T | undefined> {
  const doc = await Settings.findOne({ key });
  if (!doc) {
    return fallback;
  }
  return doc.value as T;
}

export async function setSetting<T>(key: string, value: T) {
  return Settings.findOneAndUpdate(
    { key },
    { value },
    { new: true, upsert: true }
  );
}

/**
 * Флаг источника товаров читается ПЕРЕД каждым /api/products и /api/categories,
 * а переключают его раз в полгода — держим в памяти инстанса.
 */
const mewsPosEnabledCache = createTtlCache(async () => {
  const envDefault = String(process.env.MEWS_POS_ENABLED || '').toLowerCase() === 'true';
  const stored = await getSetting<boolean>('mewsPosEnabled', envDefault);
  return Boolean(stored);
}, 60_000);

export async function getMewsPosEnabled(): Promise<boolean> {
  return mewsPosEnabledCache.get();
}

export async function setMewsPosEnabled(enabled: boolean) {
  const result = await setSetting('mewsPosEnabled', Boolean(enabled));
  mewsPosEnabledCache.invalidate();
  return result;
}

