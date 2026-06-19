import crypto from 'crypto';

/** Meta / TikTok: email lowercase + trim, then SHA-256 hex */
export function hashEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/** Meta: digits only; TikTok often same. Then SHA-256 hex */
export function hashPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  return crypto.createHash('sha256').update(digits).digest('hex');
}
