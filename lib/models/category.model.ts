import { createModel } from '../db/mongoose-compat';
import { categories } from '../db/schema';

export interface ICategory {
  name: string;
  slug: string;
  image?: string;
  icon?: string;
  active: boolean;
  order?: number;
  mewsProductTypeId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const Category = createModel(categories);

export default Category;
