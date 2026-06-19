import { createModel } from '../db/mongoose-compat';
import { optionGroups, options } from '../db/schema';
import './option.model';

/**
 * Группа опций (аналог «Optionsgruppe» в Lieferando): содержит ссылки на опции
 * из библиотеки (Option) и правила выбора. Привязывается к товарам через
 * Product.optionGroupIds и переиспользуется.
 */
export interface IOptionGroup {
  name: string;
  optionIds: string[];
  required: boolean;
  minSelect: number;
  maxSelect: number;
  active: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export const OptionGroup = createModel(optionGroups, {
  populate: {
    optionIds: () => options,
  },
});

export default OptionGroup;
