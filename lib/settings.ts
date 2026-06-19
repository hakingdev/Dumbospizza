import Settings from './models/settings.model';

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

export async function getMewsPosEnabled(): Promise<boolean> {
  const envDefault = String(process.env.MEWS_POS_ENABLED || '').toLowerCase() === 'true';
  const stored = await getSetting<boolean>('mewsPosEnabled', envDefault);
  return Boolean(stored);
}

export async function setMewsPosEnabled(enabled: boolean) {
  return setSetting('mewsPosEnabled', Boolean(enabled));
}

