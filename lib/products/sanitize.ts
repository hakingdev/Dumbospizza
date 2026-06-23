/**
 * Очистка payload товара перед записью в БД (POST/PUT /api/products).
 *
 * Форма редактирования отправляет ВЕСЬ загруженный товар обратно (включая
 * _id / createdAt / updatedAt и populate-объекты). Иммутабельные/служебные поля
 * нужно убрать, а taxRate привести к доле (0.07 / 0.19), иначе обновление может
 * упасть с 500. Категория/optionGroupIds нормализуются отдельно в маршруте
 * (нужен доступ к БД для слагов).
 */

/** Поля, которые нельзя/не нужно писать из формы. */
const IMMUTABLE_FIELDS = ['_id', 'id', '__v', 'createdAt', 'updatedAt'];

/**
 * Нормализует ставку НДС к доле: принимает доли (0.07) и проценты (7).
 * Возвращает undefined для невалидных значений (поле не трогаем).
 */
export function normalizeTaxRate(rate: unknown): number | undefined {
  const n = typeof rate === 'string' ? Number(rate) : rate;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return undefined;
  return n > 1 ? n / 100 : n;
}

export function sanitizeProductInput<T extends Record<string, any>>(raw: T): Partial<T> {
  const data: Record<string, any> = { ...raw };

  for (const field of IMMUTABLE_FIELDS) {
    delete data[field];
  }

  if ('taxRate' in data) {
    const normalized = normalizeTaxRate(data.taxRate);
    if (normalized === undefined) {
      delete data.taxRate;
    } else {
      data.taxRate = normalized;
    }
  }

  return data as Partial<T>;
}
