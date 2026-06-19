/**
 * Генерация ID, совместимого по формату с MongoDB ObjectId (24 hex-символа).
 * Используется как primary key в Postgres-таблицах, чтобы:
 *  1) данные из Mongo переносились 1:1 (тот же _id строкой);
 *  2) строковые сравнения id в коде приложения продолжали работать.
 */
export function genObjectId(): string {
  const timestamp = Math.floor(Date.now() / 1000)
    .toString(16)
    .padStart(8, '0');
  let rest = '';
  for (let i = 0; i < 16; i++) {
    rest += Math.floor(Math.random() * 16).toString(16);
  }
  return timestamp + rest;
}

/** Проверка, что строка похожа на ObjectId (24 hex). */
export function isObjectIdLike(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
}
