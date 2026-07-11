import { createModel } from '../db/mongoose-compat';
import { products, categories, optionGroups } from '../db/schema';
// регистрируем модели опций/групп, чтобы populate('optionGroupIds') и вложенный
// populate('optionIds') находили ref-таблицы в реестре
import './option-group.model';
import './option.model';

export interface IExtra {
  name: string;
  price: number;
}

export interface IProduct {
  name: string;
  description: string;
  category: string;
  basePrice: number;
  image: string;
  available: boolean;
  featured: boolean;
  valentinePromo?: boolean;
  taxRate: number;
  mewsProductId?: string;
  mewsProductTypeId?: string;
  mewsSku?: string;
  mewsProductVariantIds?: string[];
  mewsModifierSetIds?: string[];
  /** @deprecated вшитые опции — заменены на переиспользуемые группы (optionGroupIds) */
  extras?: {
    toppings?: IExtra[];
    sauces?: IExtra[];
    sides?: IExtra[];
  };
  /** привязанные переиспользуемые группы опций (Optionsgruppen) */
  optionGroupIds?: string[];
  sizes?: {
    id: string;
    variationId?: string;
    name: string;
    label: string;
    price: number;
    active?: boolean;
    /** @deprecated габарит — заменён на label */
    size?: string;
    /** @deprecated надбавка — заменена на абсолютную price */
    priceModifier?: number;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

export const Product = createModel(products, {
  populate: {
    category: () => categories,
    optionGroupIds: () => optionGroups,
  },
});

export default Product;
