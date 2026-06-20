import { isObjectIdLike } from '../db/object-id';

const OBJECT_ID_FIELDS = ['giftProductId'] as const;
const OBJECT_ID_ARRAY_FIELDS = ['targetProductIds', 'targetCategoryIds', 'giftProductIds'] as const;

function isValidObjectId(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  return isObjectIdLike(String(value));
}

/** Normalize admin form payload before Mongoose create/update. */
export function sanitizePromotionPayload(body: Record<string, unknown>): Record<string, unknown> {
  const data = { ...body };
  delete data._id;
  delete data.createdAt;
  delete data.updatedAt;

  for (const field of OBJECT_ID_FIELDS) {
    if (!(field in data)) continue;
    data[field] = isValidObjectId(data[field]) ? data[field] : null;
  }

  for (const field of OBJECT_ID_ARRAY_FIELDS) {
    if (!(field in data)) continue;
    const arr = data[field];
    if (!Array.isArray(arr)) {
      data[field] = [];
      continue;
    }
    data[field] = arr.filter((id) => isValidObjectId(id));
  }

  for (const field of ['targetItems', 'rewardItems', 'giftItems'] as const) {
    if (!(field in data)) continue;
    const arr = data[field];
    data[field] = Array.isArray(arr)
      ? arr
          .filter((it: any) => it && isValidObjectId(it.productId))
          .map((it: any) => ({
            productId: String(it.productId),
            sizeName: typeof it.sizeName === 'string' ? it.sizeName : '',
          }))
      : [];
  }

  if (data.promoCode === '') {
    data.promoCode = undefined;
  }

  // Точный выбор подарка (giftItems) — источник истины. Легаси-поля giftProductIds/
  // giftProductId выводим из него (уникальные productId), чтобы фолбэки совпадали.
  if (Array.isArray(data.giftItems) && data.giftItems.length > 0) {
    const ids = Array.from(
      new Set((data.giftItems as Array<{ productId: string }>).map((it) => String(it.productId)))
    );
    data.giftProductIds = ids;
    data.giftProductId = ids[0];
  } else if (Array.isArray(data.giftProductIds) && data.giftProductIds.length > 0) {
    data.giftProductId = data.giftProductIds[0];
    // нет giftItems, но есть легаси-список → строим giftItems (все размеры)
    data.giftItems = data.giftProductIds.map((productId: unknown) => ({
      productId: String(productId),
      sizeName: '',
    }));
  } else if (!isValidObjectId(data.giftProductId)) {
    data.giftProductId = null;
  }

  return data;
}

export function formatPromotionSaveError(error: unknown): { message: string; status: number } {
  if (error && typeof error === 'object' && (error as { name?: string }).name === 'ValidationError') {
    const message = Object.values((error as { errors?: Record<string, { message: string }> }).errors || {})
      .map((e) => e.message)
      .join('; ');
    return { message: message || 'Validation error', status: 400 };
  }
  if (error && typeof error === 'object' && (error as { name?: string }).name === 'CastError') {
    return {
      message: (error as Error).message || 'Invalid field value',
      status: 400,
    };
  }
  return {
    message: error instanceof Error ? error.message : 'Failed to save promotion',
    status: 500,
  };
}
