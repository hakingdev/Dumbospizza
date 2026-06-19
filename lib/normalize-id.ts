/** Normalize Mongo ObjectId refs (string or populated `{ _id }`) to a plain id string. */
export function normalizeObjectId(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'object') {
    const obj = value as { _id?: unknown; toString?: () => string };
    if (obj._id != null && obj._id !== '') return String(obj._id);
    if (typeof obj.toString === 'function') {
      const s = obj.toString();
      if (s && s !== '[object Object]') return s;
    }
    return undefined;
  }
  return String(value);
}
