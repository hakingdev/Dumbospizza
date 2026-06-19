import { createModel } from '../db/mongoose-compat';
import { preOrders } from '../db/schema';

export interface IPreOrder {
  name: string;
  phone: string;
  address: string;
  email?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const PreOrder = createModel(preOrders);

export default PreOrder;
