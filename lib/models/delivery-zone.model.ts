import { createModel } from '../db/mongoose-compat';
import { deliveryZones } from '../db/schema';

export interface IDeliveryZone {
  name: string;
  minOrderAmount: number;
  deliveryFee: number;
  maxDistance: number;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export const DeliveryZone = createModel(deliveryZones);

export default DeliveryZone;
