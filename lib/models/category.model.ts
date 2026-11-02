import { createModel } from '../db/mongoose-compat';
import { categories } from '../db/schema';
import type { WeeklySchedule } from '../opening-schedule';

/** Подкатегория внутри категории — метка для группировки товаров (Pizza → Rund). */
export interface ISubcategory {
  id: string;
  name: string;
  order: number;
  /** Когда метку можно заказать; нет — всегда (lib/categories/availability). */
  availabilitySchedule?: WeeklySchedule;
}

export interface ICategory {
  name: string;
  slug: string;
  image?: string;
  icon?: string;
  active: boolean;
  order?: number;
  subcategories?: ISubcategory[];
  /** Когда категорию можно заказать; null — всегда (lib/categories/availability). */
  availabilitySchedule?: WeeklySchedule | null;
  mewsProductTypeId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const Category = createModel(categories);

export default Category;
