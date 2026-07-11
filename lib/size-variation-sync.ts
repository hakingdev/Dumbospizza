import { Product } from './models/product.model';
import { SizeVariation } from './models/size-variation.model';
import {
  applySizeVariationStates,
  removeOrphanedSizeVariations,
  removeSizeVariation,
  type EmbeddedProductSize,
  type SizeVariationState,
} from './size-variation-state';

type ProductWithSizes = {
  sizes?: EmbeddedProductSize[];
};

/** Подмешивает актуальные статусы библиотеки в товары перед публичной выдачей. */
export async function hydrateSizeVariationStates<T extends ProductWithSizes>(
  products: T[]
): Promise<T[]> {
  if (products.length === 0) return products;

  const variations = (await SizeVariation.find().select('name label active').lean()) as SizeVariationState[];
  for (const product of products) {
    const existingSizes = removeOrphanedSizeVariations(product.sizes, variations);
    product.sizes = applySizeVariationStates(existingSizes, variations);
  }
  return products;
}

/**
 * Синхронизирует изменённый библиотечный размер со всеми товарами, где он уже
 * используется. Цена товара при этом не меняется.
 */
export async function syncSizeVariationToProducts(
  variation: SizeVariationState
): Promise<number> {
  const variationId = String(variation._id ?? variation.id ?? '');
  if (!variationId) return 0;

  const products = await Product.find().select('sizes');
  let updated = 0;

  for (const product of products as any[]) {
    const current = (product.sizes || []) as EmbeddedProductSize[];
    if (!current.some((size) => String(size?.variationId ?? '') === variationId)) continue;

    product.sizes = applySizeVariationStates(current, [variation]);
    await product.save();
    updated += 1;
  }

  return updated;
}

/** Удаляет библиотечный размер из всех товаров, где он был привязан. */
export async function removeSizeVariationFromProducts(
  variationId: string,
  variationName?: string
): Promise<number> {
  if (!variationId) return 0;

  const products = await Product.find().select('sizes');
  let updated = 0;

  for (const product of products as any[]) {
    const current = (product.sizes || []) as EmbeddedProductSize[];
    const next = removeSizeVariation(current, variationId, variationName);
    if (next.length === current.length) continue;

    product.sizes = next;
    await product.save();
    updated += 1;
  }

  return updated;
}
