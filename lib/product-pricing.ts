/**
 * Цены товаров.
 *
 * Модель цен (как в Lieferando): у каждого размера своя АБСОЛЮТНАЯ цена `price`.
 * Базовая цена (`basePrice`) используется только для товаров БЕЗ размеров
 * (напитки, десерты). Для товаров с размерами цена берётся из выбранного размера.
 *
 * Поля `size`/`priceModifier` оставлены для обратной совместимости со старыми
 * данными: если у размера нет `price`, цена вычисляется как basePrice + priceModifier.
 */

import { isMiniSize } from './mini-pizza-box';

export type ProductSizeLike = {
  name?: string;
  label?: string;
  price?: number;
  // legacy
  size?: string;
  priceModifier?: number;
};

export type ProductPricingLike = {
  basePrice?: number;
  sizes?: ProductSizeLike[];
};

export type ProductExtrasLike = {
  toppings?: Array<{ price?: number }>;
  sauces?: Array<{ price?: number }>;
  sides?: Array<{ price?: number }>;
};

/** Размер считается валидным, если у него есть название. */
export function getValidSizes(product: ProductPricingLike): ProductSizeLike[] {
  return (product.sizes || []).filter((s) => s?.name);
}

/**
 * Размеры, доступные клиенту для ЗАКАЗА ПОШТУЧНО. Мини-размер (18 см) хранит
 * цену сорта для «4er Mini Pizza Box» и отдельно не продаётся — скрываем его
 * из выбора размера и из расчёта цены «от …».
 */
export function getOrderableSizes(product: ProductPricingLike): ProductSizeLike[] {
  return getValidSizes(product).filter((s) => !isMiniSize(s));
}

/** Абсолютная цена размера. Поддерживает старый формат (basePrice + надбавка). */
export function getSizePrice(
  product: ProductPricingLike,
  size: ProductSizeLike | null | undefined
): number {
  if (!size) return Number(product.basePrice) || 0;
  if (size.price !== undefined && size.price !== null) {
    return Number(size.price) || 0;
  }
  // legacy fallback: basePrice + надбавка
  const base = Number(product.basePrice) || 0;
  return base + (Number(size.priceModifier) || 0);
}

/** Цена в меню / для бейджей акций: минимальная цена среди ЗАКАЗЫВАЕМЫХ размеров («от …»). */
export function getProductDisplayPrice(product: ProductPricingLike): number {
  const sizes = getOrderableSizes(product);
  if (sizes.length > 0) {
    const prices = sizes.map((s) => getSizePrice(product, s));
    return Math.round(Math.min(...prices) * 100) / 100;
  }
  return Number(product.basePrice) || 0;
}
