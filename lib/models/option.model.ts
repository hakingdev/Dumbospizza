import { createModel } from '../db/mongoose-compat';
import { options } from '../db/schema';

/**
 * Библиотека опций (аналог «Optionen» в Lieferando). Опция определяется один раз
 * (название + доп. цена), затем добавляется в группы опций и переиспользуется.
 */
export interface IOption {
  name: string;
  price: number;
  active: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export const Option = createModel(options);

export default Option;
