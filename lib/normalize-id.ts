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

/**
 * Привести ссылку на сущность к строке-id. Принимает: строку-id, populated-объект
 * (`{ _id }` ИЛИ сериализованный `{ id }`), либо undefined.
 *
 * Нужно при сохранении форм: GET отдаёт связи через `.populate()` объектами
 * ({ id, name, ... }), форма шлёт их обратно как есть, и без нормализации они
 * попадают в SQL-запрос/колонку как объект → 500.
 */
export function toRefId(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'object') {
    const o = value as { _id?: unknown; id?: unknown };
    const id = o._id ?? o.id;
    return id != null && id !== '' ? String(id) : undefined;
  }
  return String(value);
}
