import { createModel } from '../db/mongoose-compat';
import { categories } from '../db/schema';

/** Подкатегория внутри категории — метка для группировки товаров (Pizza → Rund). */
export interface ISubcategory {
  id: string;
  name: string;
  order: number;
}

export interface ICategory {
  name: string;
  slug: string;
  image?: string;
  icon?: string;
  active: boolean;
  order?: number;
  subcategories?: ISubcategory[];
  mewsProductTypeId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const Category = createModel(categories);

export default Category;
