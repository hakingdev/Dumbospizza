import { createModel } from '../db/mongoose-compat';
import { sizeVariations } from '../db/schema';

/**
 * Библиотека размеров (аналог «Artikelvariationen» в Lieferando).
 */
export interface ISizeVariation {
  name: string;
  label: string;
  order: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const SizeVariation = createModel(sizeVariations);

export default SizeVariation;
